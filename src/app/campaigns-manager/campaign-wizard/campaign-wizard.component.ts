import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { CampaignAudience, CampaignModel, emptyCampaignStats } from 'src/app/common/models/domain/campaign.model';
import { AudiencePreview, CampaignService } from 'src/app/common/services/data/campaign.service';
import { ProductService } from 'src/app/common/services/data/product.service';
import { EventService } from 'src/app/common/services/data/event.service';
import { TagRuleService } from 'src/app/common/services/data/tag-rule.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { ProductModel } from 'src/app/common/models/utils/product.model';
import { EventModel } from 'src/app/common/models/domain/event.model';

// Campaign wizard (Campaign Manager v2, Phase 2): creates/edits the
// campaign SHELL - what's promoted (goal), through which channels, to
// whom (audience). The emails themselves are touches added on the detail
// view (email-touch-editor); web popups arrive in Phase 5 (the checkbox
// is visible but disabled so the shape of the feature is discoverable).
// In-page mode hosted by campaigns.component, same no-route treatment as
// the detail view.
@Component({
    selector: 'app-campaign-wizard',
    templateUrl: './campaign-wizard.component.html',
    styleUrls: ['./campaign-wizard.component.scss'],
    standalone: false
})
export class CampaignWizardComponent implements OnInit {
  /** null = create a new campaign. */
  @Input() campaign: CampaignModel | null = null;
  /** Emits the saved campaign, or null when cancelled. */
  @Output() closed = new EventEmitter<CampaignModel | null>();

  form: FormGroup;
  saving = false;

  products: ProductModel[] = [];
  events: EventModel[] = [];
  knownTags: string[] = [];

  audiencePreview: AudiencePreview | null = null;
  previewing = false;

  private readonly screenKey = 'campaigns-manager.campaigns';

  constructor(
    private service: CampaignService,
    private productService: ProductService,
    private eventService: EventService,
    private tagRuleService: TagRuleService,
    private permissionService: PermissionService,
    private snackbar: SnackbarService,
    private fb: FormBuilder
  ) {
    this.form = this.fb.group({
      name: ['', Validators.required],
      goal: ['other', Validators.required],
      otherKind: ['general'],
      productId: [null],
      eventId: [null],
      // Either channel alone or both - a web-ONLY campaign (e.g. a
      // subscriber-growth popup with no email at all) is a first-class
      // shape (user's original brief: "email or web... or both!").
      emailChannel: [true],
      webChannel: [false],
      audienceMode: ['flags', Validators.required],
      audienceFlags: [['subscribedToNewsletter']],
      audienceTags: [[]],
      audienceEmails: [''],
      startDate: [null],
      endDate: [null]
    });

    // Any audience change invalidates a shown preview - the count would lie.
    this.form.valueChanges.subscribe(() => this.audiencePreview = null);

    // Audience is an EMAIL concept - a web-only campaign has none (popups
    // show to every visitor), so the requirement follows the checkbox.
    this.form.get('emailChannel')?.valueChanges.subscribe((email: boolean) => {
      const mode = this.form.get('audienceMode');
      mode?.setValidators(email ? [Validators.required] : []);
      mode?.updateValueAndValidity({ emitEvent: false });
    });
  }

  ngOnInit(): void {
    this.productService.getAllByValue('isActive', true).then((products) => this.products = products);
    this.eventService.getAllByValue('isActive', true).then((events) => this.events = events);
    this.tagRuleService.getAll().then((rules) => {
      this.knownTags = [...new Set(rules.map((r) => r.tag).filter(Boolean))].sort();
    });

    if (this.campaign) {
      const audience = this.campaign.audience;
      this.form.patchValue({
        name: this.campaign.name,
        goal: this.campaign.goal,
        otherKind: this.campaign.otherKind ?? 'general',
        productId: this.campaign.productId ?? null,
        eventId: this.campaign.eventId ?? null,
        emailChannel: (this.campaign.channels ?? []).includes('email'),
        webChannel: (this.campaign.channels ?? []).includes('web'),
        audienceMode: audience?.mode ?? 'flags',
        audienceFlags: audience?.flags ?? ['subscribedToNewsletter'],
        audienceTags: audience?.tags ?? [],
        audienceEmails: (audience?.emails ?? []).join('\n'),
        startDate: this.toInputDate(this.campaign.startDate),
        endDate: this.toInputDate(this.campaign.endDate)
      });
    }
  }

  get goal(): string {
    return this.form.get('goal')?.value;
  }

  get audienceMode(): string {
    return this.form.get('audienceMode')?.value;
  }

  get emailChannel(): boolean {
    return this.form.get('emailChannel')?.value === true;
  }

  canSave(): boolean {
    return this.campaign?.id
      ? this.permissionService.canEdit(this.screenKey)
      : this.permissionService.canAdd(this.screenKey);
  }

  buildAudience(): CampaignAudience {
    const value = this.form.value;
    const audience: CampaignAudience = { mode: value.audienceMode };
    if (value.audienceMode === 'flags') {
      audience.flags = value.audienceFlags ?? [];
    } else if (value.audienceMode === 'tags') {
      audience.tags = value.audienceTags ?? [];
    } else if (value.audienceMode === 'list') {
      audience.emails = (value.audienceEmails ?? '')
        .split(/[\s,;]+/)
        .map((e: string) => e.trim().toLowerCase())
        .filter((e: string) => e.includes('@'));
    }
    return audience;
  }

  previewAudience(): void {
    this.previewing = true;
    this.service.previewAudience(this.buildAudience())
      .then((preview) => this.audiencePreview = preview)
      .catch((err) => this.snackbar.error(err?.message ?? 'Audience preview failed'))
      .finally(() => this.previewing = false);
  }

  async save(): Promise<void> {
    if (!this.canSave() || this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.value;
    if (value.goal === 'product' && !value.productId) {
      this.snackbar.error('Pick the product this campaign promotes.');
      return;
    }
    if (value.goal === 'event' && !value.eventId) {
      this.snackbar.error('Pick the event this campaign promotes.');
      return;
    }
    if (!value.emailChannel && !value.webChannel) {
      this.snackbar.error('Pick at least one channel - email, web popup, or both.');
      return;
    }

    this.saving = true;
    // Explicit nulls, never undefined (Firestore setDoc gotcha - CLAUDE.md).
    const payload: CampaignModel = {
      ...(this.campaign ?? new CampaignModel()),
      name: value.name,
      goal: value.goal,
      otherKind: value.goal === 'other' ? value.otherKind : null,
      productId: value.goal === 'product' ? value.productId : null,
      eventId: value.goal === 'event' ? value.eventId : null,
      channels: [
        ...(value.emailChannel ? ['email'] : []),
        ...(value.webChannel ? ['web'] : []),
        // Social channels are stamped by the social composer's MARK AS
        // POSTED, not chosen here - carry them through so a wizard edit
        // can't silently drop them.
        ...(this.campaign?.channels ?? []).filter((c) => c !== 'email' && c !== 'web')
      ] as CampaignModel['channels'],
      audience: value.emailChannel ? this.buildAudience() : null,
      startDate: value.startDate ? new Date(value.startDate) : null,
      endDate: value.endDate ? new Date(value.endDate) : null,
      status: this.campaign?.status ?? 'draft',
      couponId: this.campaign?.couponId ?? null,
      source: this.campaign?.source ?? null,
      stats: this.campaign?.stats ?? emptyCampaignStats(),
      schemaVersion: 2
    };

    try {
      const saved = this.campaign?.id
        ? await this.service.update(this.campaign.id, payload)
        : await this.service.add(payload);
      this.snackbar.success('Campaign Saved');
      this.closed.emit(saved);
    } catch (err) {
      this.snackbar.error('Save failed: ' + ((err as Error)?.message ?? err));
    } finally {
      this.saving = false;
    }
  }

  cancel(): void {
    this.closed.emit(null);
  }

  private toInputDate(value: unknown): string | null {
    const date = dateFromTimestamp(value as never);
    if (!date) {
      return null;
    }
    // datetime-local wants local time without the timezone suffix.
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
}
