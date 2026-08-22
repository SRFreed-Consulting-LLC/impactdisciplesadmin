import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { CampaignAudience, CampaignModel, effectiveStatus, emptyCampaignStats } from 'src/app/common/models/domain/campaign.model';
import { AudiencePreview, CampaignService } from 'src/app/common/services/data/campaign.service';
import { ProductService } from 'src/app/common/services/data/product.service';
import { EventService } from 'src/app/common/services/data/event.service';
import { TagRuleService } from 'src/app/common/services/data/tag-rule.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { dateFromTimestamp } from '@impact-common/shared/utils/date-from-timestamp';
import { ProductModel } from '@impact-common/shared/models/utils/product.model';
import { EventModel } from '@impact-common/shared/models/domain/event.model';
import { SeriesModel } from '@impact-common/shared/models/utils/series.model';
import { CampaignOfferModel, OfferTargetKind } from '@impact-common/shared/models/utils/campaign-offer.model';
import { SeriesService } from 'src/app/common/services/data/series.service';
import { CampaignOfferService } from 'src/app/common/services/data/campaign-offer.service';
import { CouponService } from 'src/app/common/services/data/coupon.service';
import { CouponModel } from '@impact-common/shared/models/utils/coupon.model';

// Campaign wizard (Campaign Manager v2, Phase 2): creates/edits the
// campaign SHELL - what's promoted (goal), through which channels, to
// whom (audience). The emails themselves are touches added on the detail
// view (campaign-email-editor); web popups arrive in Phase 5 (the checkbox
// is visible but disabled so the shape of the feature is discoverable).
// In-page mode hosted by campaigns.component, same no-route treatment as
// the detail view.
/** Sentinel for the coupon picker's "create a new one" option. */
const NEW_COUPON = '__new__';

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
  series: SeriesModel[] = [];
  coupons: CouponModel[] = [];
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
    private seriesService: SeriesService,
    private offerService: CampaignOfferService,
    private couponService: CouponService,
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
      // Social channels are pickable at creation now. The composer still
      // stamps 'posted', but a campaign that intends social should say so up
      // front rather than acquiring the channel as a side effect.
      facebookChannel: [false],
      twitterChannel: [false],
      instagramChannel: [false],
      audienceMode: ['flags', Validators.required],
      audienceFlags: [['subscribedToNewsletter']],
      audienceTags: [[]],
      audienceEmails: [''],
      startDate: [null],
      endDate: [null],
      // ---- Offer (Campaign Manager v3) ----
      // One shape for every campaign type: the type decides starter content,
      // the offer decides what a shopper pays. Optional on all three.
      offerEnabled: [false],
      offerTargetKind: ['product'],
      offerTargetId: [null],
      offerDiscountType: ['percentOff'],
      offerDiscountValue: [null],
      offerFreeShipping: [false],
      // ---- Signup coupon ----
      couponEnabled: [false],
      couponId: [null],
      couponCode: [''],
      couponPercentOff: [null],
      couponExpiresAt: [null]
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
    this.seriesService.getAll().then((series) =>
      this.series = series.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')));
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
        facebookChannel: (this.campaign.channels ?? []).includes('facebook'),
        twitterChannel: (this.campaign.channels ?? []).includes('twitter'),
        instagramChannel: (this.campaign.channels ?? []).includes('instagram'),
        audienceMode: audience?.mode ?? 'flags',
        audienceFlags: audience?.flags ?? ['subscribedToNewsletter'],
        audienceTags: audience?.tags ?? [],
        audienceEmails: (audience?.emails ?? []).join('\n'),
        startDate: this.toInputDate(this.campaign.startDate),
        endDate: this.toInputDate(this.campaign.endDate)
      });
    }

    void this.initOffer();
    void this.initCoupon();
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

  // ---- Offer (Campaign Manager v3) ----

  get offerEnabled(): boolean {
    return this.form.get('offerEnabled')?.value === true;
  }

  get offerTargetKind(): OfferTargetKind {
    return this.form.get('offerTargetKind')?.value;
  }

  /** What the target picker lists, following the chosen target kind. */
  get offerTargetItems(): { id: string; label: string }[] {
    if (this.offerTargetKind === 'series') {
      return this.series.map((s) => ({ id: s.id!, label: s.name ?? '(unnamed series)' }));
    }
    if (this.offerTargetKind === 'event') {
      return this.events.map((e) => ({ id: e.id!, label: e.eventName ?? '(unnamed event)' }));
    }
    return this.products.map((p) => ({ id: p.id!, label: p.title ?? '(untitled product)' }));
  }

  /**
   * Event offers are the early-bird shape: a fixed replacement price, shown
   * only to visitors who arrived through the campaign link. Percent-off is a
   * product/series concept, so the discount type follows the target kind
   * rather than being a free choice that can be set to a nonsense pairing.
   */
  get offerIsEarlyBird(): boolean {
    return this.offerTargetKind === 'event';
  }

  onOfferTargetKindChange(kind: OfferTargetKind): void {
    this.form.patchValue({
      offerTargetId: null,
      offerDiscountType: kind === 'event' ? 'fixedPrice' : 'percentOff',
      offerFreeShipping: kind === 'event' ? false : this.form.get('offerFreeShipping')?.value
    });
  }

  /**
   * Seeds the offer step from the campaign's own goal, and loads an existing
   * offer when editing. A product campaign discounting something OTHER than
   * its own product is legal but unusual, so the target starts on the thing
   * the campaign already promotes.
   */
  private async initOffer(): Promise<void> {
    const goal = this.campaign?.goal;
    if (!this.campaign?.id) {
      if (goal === 'product' && this.campaign?.productId) {
        this.form.patchValue({ offerTargetKind: 'product', offerTargetId: this.campaign.productId });
      } else if (goal === 'event' && this.campaign?.eventId) {
        this.form.patchValue({
          offerTargetKind: 'event',
          offerTargetId: this.campaign.eventId,
          offerDiscountType: 'fixedPrice'
        });
      }
      return;
    }

    const offer = await this.offerService.forCampaign(this.campaign.id);
    if (!offer) {
      return;
    }
    this.form.patchValue({
      offerEnabled: true,
      offerTargetKind: offer.target?.kind ?? null,
      offerTargetId: offer.target?.id ?? null,
      offerDiscountType: offer.discount?.type ?? 'percentOff',
      offerDiscountValue: offer.discount?.value ?? null,
      offerFreeShipping: offer.freeShipping === true
    });
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
    const socialPicked = value.facebookChannel || value.twitterChannel || value.instagramChannel;
    if (!value.emailChannel && !value.webChannel && !socialPicked) {
      this.snackbar.error('Pick at least one channel - email, web popup, or social.');
      return;
    }
    if (value.offerEnabled) {
      if (!value.offerTargetId) {
        this.snackbar.error('Pick what the offer applies to.');
        return;
      }
      const amount = Number(value.offerDiscountValue);
      if (!Number.isFinite(amount) || amount <= 0) {
        this.snackbar.error(
          value.offerDiscountType === 'fixedPrice'
            ? 'Enter the early-bird price.'
            : 'Enter a percentage off.'
        );
        return;
      }
      if (value.offerDiscountType === 'percentOff' && amount > 100) {
        this.snackbar.error('A percentage off cannot exceed 100.');
        return;
      }
    }
    if (value.couponEnabled) {
      if (!value.couponId) {
        this.snackbar.error('Pick a coupon to give subscribers, or create one.');
        return;
      }
      if (this.creatingCoupon) {
        const code = (value.couponCode ?? '').trim();
        const percent = Number(value.couponPercentOff);
        if (!code) {
          this.snackbar.error('Enter the coupon code subscribers will type.');
          return;
        }
        if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
          this.snackbar.error('Enter a coupon percentage between 1 and 100.');
          return;
        }
      }
      // An open-ended campaign has no end date to inherit, so the expiry
      // has to be chosen - otherwise the code stays live for years.
      if (this.couponNeedsExpiry && !value.couponExpiresAt) {
        this.snackbar.error('This campaign has no end date, so give the coupon its own expiry.');
        return;
      }
    }

    this.saving = true;
    const campaignEndDate = value.endDate ? new Date(value.endDate) : null;

    let couponId: string | null = null;
    try {
      couponId = await this.resolveCoupon(campaignEndDate);
    } catch (err) {
      this.snackbar.error('Could not save the coupon: ' + ((err as Error)?.message ?? err));
      this.saving = false;
      return;
    }
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
        ...(value.facebookChannel ? ['facebook'] : []),
        ...(value.twitterChannel ? ['twitter'] : []),
        ...(value.instagramChannel ? ['instagram'] : [])
      ] as CampaignModel['channels'],
      audience: value.emailChannel ? this.buildAudience() : null,
      startDate: value.startDate ? new Date(value.startDate) : null,
      endDate: campaignEndDate,
      status: this.campaign?.status ?? 'draft',
      couponId,
      source: this.campaign?.source ?? null,
      stats: this.campaign?.stats ?? emptyCampaignStats(),
      schemaVersion: 2
    };

    try {
      const saved = this.campaign?.id
        ? await this.service.update(this.campaign.id, payload)
        : await this.service.add(payload);

      await this.saveOffer(saved);

      this.snackbar.success('Campaign Saved');
      this.closed.emit(saved);
    } catch (err) {
      this.snackbar.error('Save failed: ' + ((err as Error)?.message ?? err));
    } finally {
      this.saving = false;
    }
  }

  /**
   * Publishes the campaign's offer, or stands it down when the offer was
   * switched off.
   *
   * The published doc carries its OWN window and active flag, copied from the
   * campaign here, because the storefront cannot read a campaign to ask
   * whether one is still running.
   *
   * isActive follows the campaign being effectively LIVE - a draft campaign
   * must never discount anything, which is the whole reason the flag is
   * copied rather than inferred from the dates alone.
   */
  private async saveOffer(saved: CampaignModel): Promise<void> {
    const value = this.form.value;
    const campaignId = saved.id;
    if (!campaignId) {
      return;
    }

    if (!value.offerEnabled) {
      // Only stand down something that exists - deactivate() is an update,
      // and updating a missing doc would throw.
      const existing = await this.offerService.forCampaign(campaignId);
      if (existing) {
        await this.offerService.deactivate(campaignId);
      }
      return;
    }

    const offer: CampaignOfferModel = {
      campaignId,
      target: { kind: value.offerTargetKind, id: value.offerTargetId },
      discount: {
        type: value.offerDiscountType,
        value: Number(value.offerDiscountValue)
      },
      freeShipping: value.offerDiscountType === 'fixedPrice' ? false : value.offerFreeShipping === true,
      isActive: effectiveStatus(saved) === 'live',
      startsAt: saved.startDate ?? null,
      endsAt: saved.endDate ?? null,
      requiresAttribution: value.offerTargetKind === 'event'
    };

    await this.offerService.publish(campaignId, offer);
  }

  // ---- Signup coupon (Campaign Manager v3) ----
  // A shared code per campaign, not one per subscriber: the owner's call, and
  // it means no code generation and no redemption ledger. The campaign POINTS
  // AT a real coupons record - the discount system is not duplicated here -
  // which is what CampaignModel.couponId has always been for.

  get couponEnabled(): boolean {
    return this.form.get('couponEnabled')?.value === true;
  }

  get creatingCoupon(): boolean {
    return this.form.get('couponId')?.value === NEW_COUPON;
  }

  /**
   * Whether the admin must supply a coupon expiry by hand.
   *
   * A coupon inherits the campaign's end date. An open-ended campaign has none
   * to inherit, so the admin is made to pick one - otherwise a signup reward
   * stays redeemable for years, which is the failure the expiry exists to stop.
   */
  get couponNeedsExpiry(): boolean {
    return this.couponEnabled && !this.form.get('endDate')?.value;
  }

  private async initCoupon(): Promise<void> {
    this.coupons = (await this.couponService.getAll())
      .filter((c) => !c.isAffilliate)
      .sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''));

    if (this.campaign?.couponId) {
      this.form.patchValue({ couponEnabled: true, couponId: this.campaign.couponId });
    }
  }

  /**
   * Resolves the campaign's coupon, creating one when the admin chose to, and
   * stamps the expiry on it.
   *
   * Returns the id to store on the campaign, or null when the campaign offers
   * no signup reward.
   */
  private async resolveCoupon(campaignEndDate: Date | null): Promise<string | null> {
    const value = this.form.value;
    if (!value.couponEnabled) {
      return null;
    }

    const expiresAt = campaignEndDate ??
      (value.couponExpiresAt ? new Date(value.couponExpiresAt) : null);

    if (value.couponId === NEW_COUPON) {
      const created = await this.couponService.add({
        code: (value.couponCode ?? '').trim(),
        percentOff: Number(value.couponPercentOff),
        isActive: true,
        isAffilliate: false,
        expiresAt
      } as CouponModel);
      return created.id ?? null;
    }

    // An existing coupon still gets the campaign's expiry: the campaign is what
    // is handing the code out, so it is what decides how long it lives.
    if (value.couponId && expiresAt) {
      await this.couponService.updateFields(value.couponId, { expiresAt });
    }
    return value.couponId ?? null;
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
