import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { CampaignModel, CampaignStatus, CampaignType, effectiveStatus, emptyCampaignStats } from 'src/app/common/models/domain/campaign.model';
import { CampaignTemplate } from 'src/app/common/models/domain/campaign-template.model';
import { CampaignService } from 'src/app/common/services/data/campaign.service';
import { ProductService } from 'src/app/common/services/data/product.service';
import { EventService } from 'src/app/common/services/data/event.service';
import { CouponService } from 'src/app/common/services/data/coupon.service';
import { EMailTemplatesService } from 'src/app/common/services/data/email-templates.service';
import { ProductModel } from 'src/app/common/models/utils/product.model';
import { EventModel } from 'src/app/common/models/domain/event.model';
import { CouponModel } from 'src/app/common/models/utils/coupon.model';
import { TagRuleService } from 'src/app/common/services/data/tag-rule.service';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';

// The Composer: create/edit for a campaign, hosted as an in-page mode by
// both Campaigns and Status Board (same no-route treatment as Products'
// editor - see products.component.ts's own comment). Left half is the form
// (fields swap with `type`), right half is a live preview of the
// public-facing piece - the email for product/event pushes, the landing
// block for lead capture. The preview renders straight off the form value,
// so what's approved is what ships.
@Component({
    selector: 'app-campaign-composer',
    templateUrl: './campaign-composer.component.html',
    styleUrls: ['./campaign-composer.component.scss'],
    standalone: false
})
export class CampaignComposerComponent implements OnInit {
  /** Existing campaign to edit, or null for a new one. */
  @Input() campaign: CampaignModel | null = null;
  /** Gallery recipe a NEW campaign starts from (ignored when editing).
   *  Null = started blank. */
  @Input() template: CampaignTemplate | null = null;
  /** true = saved (caller should reload its data). */
  @Output() closed = new EventEmitter<boolean>();

  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);

  // One-time reference loads, not streams - same reasoning as
  // products.component.ts's reference data (these change rarely; standing
  // listeners here would re-trigger the WebChannel handshake race).
  products: ProductModel[] = [];
  events: EventModel[] = [];
  coupons: CouponModel[] = [];
  emailTemplates: { id: string; name: string }[] = [];
  // Distinct tag names across all tag rules - the 'auto' type's audience
  // picker options (a campaign can also target manually-applied tags,
  // which share these names).
  knownTags: string[] = [];

  constructor(
    private service: CampaignService,
    private productService: ProductService,
    private eventService: EventService,
    private couponService: CouponService,
    private emailTemplatesService: EMailTemplatesService,
    private tagRuleService: TagRuleService,
    private fb: FormBuilder,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.productService.getAll().then((products) => {
      this.products = products.filter((p) => p.isActive);
    });
    this.eventService.getAll().then((events) => {
      this.events = events.filter((e) => e.isActive);
    });
    this.couponService.getAll().then((coupons) => {
      this.coupons = coupons.filter((c) => c.isActive);
    });
    this.emailTemplatesService.getAll().then((templates) => {
      this.emailTemplates = templates.map((t) => ({ id: t.id!, name: t.name }));
    });
    this.tagRuleService.getAll().then((rules) => {
      const fromRules = rules.map((rule) => rule.tag?.trim()).filter(Boolean) as string[];
      // An edited campaign may target tags whose rule was since deleted -
      // keep them selectable rather than silently dropping them.
      const fromCampaign = this.campaign?.targetTags ?? [];
      this.knownTags = Array.from(new Set([...fromRules, ...fromCampaign]));
    });

    this.buildForm();
  }

  get isEdit(): boolean {
    return !!this.campaign;
  }

  get displayStatus(): CampaignStatus {
    return this.campaign ? effectiveStatus(this.campaign) : 'draft';
  }

  get isLive(): boolean {
    return this.displayStatus === 'live';
  }

  get isEnded(): boolean {
    return this.displayStatus === 'ended';
  }

  get type(): CampaignType {
    return this.form?.value.type ?? this.form?.getRawValue().type ?? 'product';
  }

  // "Started from X" - informational only, never a live link back to the
  // recipe (see campaign-template.model.ts).
  get startedFrom(): string | null {
    return this.campaign?.templateName ?? this.template?.name ?? null;
  }

  private buildForm(): void {
    const c = this.campaign;
    const d = this.template?.defaults;

    this.form = this.fb.group({
      name: [c?.name ?? this.template?.name ?? '', Validators.required],
      type: [{ value: c?.type ?? this.template?.type ?? 'product', disabled: this.isLive || this.isEnded }],
      productId: [c?.productId ?? null],
      eventId: [c?.eventId ?? null],
      couponId: [c?.couponId ?? null],
      emailTemplateId: [c?.emailTemplateId ?? null],
      subject: [c?.subject ?? d?.subject ?? ''],
      message: [c?.message ?? d?.message ?? ''],
      headline: [c?.headline ?? d?.headline ?? ''],
      supportingText: [c?.supportingText ?? d?.supportingText ?? ''],
      thankYouMessage: [c?.thankYouMessage ?? d?.thankYouMessage ?? ''],
      placement: [c?.placement ?? d?.placement ?? ''],
      targetTags: [c?.targetTags ?? []],
      sendAfterDays: [c?.sendAfterDays ?? null, [Validators.min(0)]],
      startDate: [dateFromTimestamp(c?.startDate) ?? null],
      endDate: [dateFromTimestamp(c?.endDate) ?? null]
    });

    this.applyTypeValidators(this.form.getRawValue().type);
    this.form.get('type')!.valueChanges.subscribe((type: CampaignType) => this.applyTypeValidators(type));
  }

  // Only the active type's fields are required - the other groups aren't
  // just optional, they're not part of this campaign at all (and get
  // null-ed out on save, see buildPayload()).
  private applyTypeValidators(type: CampaignType): void {
    const required: Record<CampaignType, string[]> = {
      'product': ['productId', 'subject'],
      'event': ['eventId', 'subject'],
      'lead-capture': ['headline', 'couponId', 'placement'],
      'auto': ['subject', 'targetTags', 'sendAfterDays']
    };
    const all = ['productId', 'eventId', 'couponId', 'subject', 'headline', 'placement', 'targetTags', 'sendAfterDays'];

    all.forEach((field) => {
      const validators = required[type].includes(field) ? [Validators.required] : [];
      if (field === 'sendAfterDays') {
        validators.push(Validators.min(0));
      }
      const control = this.form.get(field)!;
      control.setValidators(validators);
      control.updateValueAndValidity({ emitEvent: false });
    });
  }

  // ---- Preview lookups ----

  get selectedProduct(): ProductModel | undefined {
    return this.products.find((p) => p.id === this.form?.value.productId);
  }

  get selectedEvent(): EventModel | undefined {
    return this.events.find((e) => e.id === this.form?.value.eventId);
  }

  get selectedCoupon(): CouponModel | undefined {
    return this.coupons.find((c) => c.id === this.form?.value.couponId);
  }

  get eventStartDate(): Date | null {
    const date = dateFromTimestamp(this.selectedEvent?.startDate);
    return date instanceof Date ? date : null;
  }

  get discountedPrice(): number | null {
    const price = this.selectedProduct?.salePrice;
    const percent = this.selectedCoupon?.percentOff;
    if (!price || !percent) {
      return null;
    }
    return price * (1 - percent / 100);
  }

  // ---- Actions ----

  onCancel(): void {
    this.closed.emit(false);
  }

  onSaveDraft(): void {
    this.persist(this.draftStatus(), this.isEdit ? 'Campaign Updated' : 'Campaign Saved');
  }

  onLaunch(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    // For 'auto', going live IS the wiring - the hourly
    // autoCampaignScheduler Cloud Function sends to eligible tagged
    // customers while the campaign is effectively live.
    const message = this.type === 'auto' ?
      '<i>Launch this automation? Eligible tagged customers begin receiving it on the next hourly run.</i>' :
      '<i>Launch this campaign? It will show as live immediately.</i>';
    this.confirmService.confirm(message, 'Confirm').then((confirmed) => {
      if (confirmed) {
        // TODO(campaigns): launching a product/event push should also fire
        // the email send (existing Email Templates + Mailchimp, full
        // flagged subscriber list - no audience narrowing, standing rule).
        // That wiring is the next build-order step on this branch; until
        // then Launch only makes those types live for tracking. ('auto'
        // needs no send wiring here - the scheduler owns it.)
        this.persist('live', 'Campaign Launched');
      }
    });
  }

  onEnd(): void {
    this.confirmService.confirm('<i>End this campaign now?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.persist('ended', 'Campaign Ended');
      }
    });
  }

  // Draft vs scheduled isn't a user-facing choice - a draft with a start
  // date IS scheduled (the Status Board's columns rely on this).
  private draftStatus(): CampaignStatus {
    const stored = this.campaign?.status;
    if (stored === 'live' || stored === 'ended') {
      return stored;
    }
    return this.form.value.startDate ? 'scheduled' : 'draft';
  }

  private persist(status: CampaignStatus, successMessage: string): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.inProgress$.next(true);
    const value = this.buildPayload(status);

    const request = this.isEdit ? this.service.update(this.campaign!.id!, value) : this.service.add(value);

    request.then((result) => {
      this.inProgress$.next(false);
      if (result) {
        this.snackbar.success(successMessage);
        this.closed.emit(true);
      } else {
        this.snackbar.error('Some Error Occured');
      }
    });
  }

  private buildPayload(status: CampaignStatus): CampaignModel {
    const raw = this.form.getRawValue();
    const type: CampaignType = raw.type;

    // Explicit nulls (never undefined - the setDoc() rejection gotcha, see
    // CLAUDE.md/PurchasesService.withStatusHistory) for every field that
    // isn't part of this campaign's type, so switching type while drafting
    // leaves no stale values behind.
    const isLead = type === 'lead-capture';
    const isAuto = type === 'auto';

    return {
      ...this.campaign,
      name: raw.name,
      type,
      status,
      startDate: status === 'live' ? (raw.startDate ?? new Date()) : (raw.startDate ?? null),
      endDate: status === 'ended' ? (raw.endDate ?? new Date()) : (raw.endDate ?? null),
      productId: type === 'product' ? raw.productId : null,
      eventId: type === 'event' ? raw.eventId : null,
      couponId: raw.couponId ?? null,
      emailTemplateId: isLead ? null : raw.emailTemplateId,
      subject: isLead ? null : raw.subject || null,
      message: isLead ? null : raw.message || null,
      headline: isLead ? raw.headline : null,
      supportingText: isLead ? raw.supportingText || null : null,
      thankYouMessage: isLead ? raw.thankYouMessage || null : null,
      placement: isLead ? raw.placement : null,
      targetTags: isAuto ? (raw.targetTags?.length ? raw.targetTags : null) : null,
      sendAfterDays: isAuto ? (raw.sendAfterDays ?? null) : null,
      templateName: this.campaign?.templateName ?? this.template?.name ?? null,
      stats: this.campaign?.stats ?? emptyCampaignStats()
    };
  }
}
