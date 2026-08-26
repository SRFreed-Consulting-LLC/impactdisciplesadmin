import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { CampaignModel, CampaignStatus, campaignKindLabel, channelLabel, effectiveStatus } from 'src/app/common/models/domain/campaign.model';
import { CampaignEmailModel } from 'src/app/common/models/domain/campaign-email.model';
import { CampaignEmailService } from 'src/app/common/services/data/campaign-email.service';
import { CampaignService } from 'src/app/common/services/data/campaign.service';
import { CampaignPopupModel } from 'src/app/common/models/domain/campaign-popup.model';
import { CampaignPopupService } from 'src/app/common/services/data/campaign-popup.service';
import { CampaignOfferService } from 'src/app/common/services/data/campaign-offer.service';
import { CouponService } from 'src/app/common/services/data/coupon.service';
import { ProductService } from 'src/app/common/services/data/product.service';
import { EventService } from 'src/app/common/services/data/event.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { QueryParam, WhereFilterOperandKeys } from 'src/app/common/dao/firebase.dao';
import { dateFromTimestamp, toMillis } from '@impact-common/shared/utils/date-from-timestamp';
import { SentEmailPreviewDialogComponent } from '../sent-emails/sent-email-preview-dialog.component';
import { PublishWebDialogComponent } from './publish-web-dialog.component';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { describeCampaignDelete, describeCampaignDeleteResult } from '../campaigns/campaign-delete-text';

// A single funnel-stage tile on the detail header.
interface FunnelTile {
  label: string;
  value: string;
  sub?: string;
}

// Campaign detail - the v2 centerpiece: what this effort promoted, its
// funnel (from denormalized stats - opens are labeled approximate, mail
// proxies inflate them), and the touches timeline (every email that went
// out for it, newest first, each previewable / copyable into the
// designer). Phase 2 added authoring: New Email opens the touch editor
// (in-page), draft/scheduled rows reopen it, sending rows show ledger
// progress, and Edit Campaign hands off to the wizard via (edit).
@Component({
    selector: 'app-campaign-detail',
    templateUrl: './campaign-detail.component.html',
    styleUrls: ['./campaign-detail.component.scss'],
    standalone: false
})
export class CampaignDetailComponent implements OnInit {
  @Input() campaign!: CampaignModel;
  @Output() closed = new EventEmitter<void>();
  @Output() edit = new EventEmitter<CampaignModel>();
  // Fired after a successful cascade delete - the host returns to the list.
  @Output() deleted = new EventEmitter<void>();

  mode: 'view' | 'editPopup' | 'social' = 'view';

  touches: CampaignEmailModel[] = [];
  loadingTouches = true;

  // The campaign's web popup (one per campaign, doc id == campaignId).
  popup: CampaignPopupModel | null = null;

  // Resolved name of the promoted product/event, when the goal has one.
  promotesName = '';

  kindLabel = campaignKindLabel;
  channelLabel = channelLabel;
  effectiveStatus = effectiveStatus;
  toDate = dateFromTimestamp;

  constructor(
    private emailService: CampaignEmailService,
    private campaignService: CampaignService,
    private popupService: CampaignPopupService,
    private offerService: CampaignOfferService,
    private couponService: CouponService,
    private productService: ProductService,
    private eventService: EventService,
    private permissionService: PermissionService,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService,
    private dialog: MatDialog,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadTouches();
    this.loadPopup();

    if (this.campaign.goal === 'product' && this.campaign.productId) {
      this.productService.getById(this.campaign.productId).then((p) => this.promotesName = p?.title ?? '');
    } else if (this.campaign.goal === 'event' && this.campaign.eventId) {
      this.eventService.getById(this.campaign.eventId).then((e) => this.promotesName = e?.eventName ?? '');
    }
  }

  private loadTouches(): void {
    this.loadingTouches = true;
    // One page of 200 covers even the longest series (a 5-year monthly
    // newsletter is ~60 touches). Composite index (campaignId, sentAt DESC)
    // - PLUS a second query for drafts/scheduled/sending touches, which
    // have no sentAt yet and orderBy would silently exclude (the classic
    // Firestore orderBy gotcha, MIGRATION.md).
    Promise.all([
      this.emailService.getPage(200, null, 'sentAt', 'desc',
        [new QueryParam('campaignId', WhereFilterOperandKeys.equal, this.campaign.id)]),
      this.emailService.queryAllByMultiValue([
        new QueryParam('campaignId', WhereFilterOperandKeys.equal, this.campaign.id),
        new QueryParam('status', WhereFilterOperandKeys.in, ['draft', 'scheduled', 'sending'])
      ])
    ]).then(([sentPage, unsent]) => {
      const unsentIds = new Set(unsent.map((t) => t.id));
      this.touches = [
        ...unsent,
        ...sentPage.items.filter((t) => !unsentIds.has(t.id))
      ];
      this.loadingTouches = false;
    });
  }

  get funnel(): FunnelTile[] {
    const s = this.campaign.stats;
    const channels = this.campaign.channels ?? [];
    const pct = (part: number) => s.sent > 0 ? Math.round((part / s.sent) * 100) + '%' : '';
    const tiles: FunnelTile[] = [];
    // Email stages only when the campaign HAS the email channel - a
    // web-only campaign's funnel is popup -> click -> purchase.
    if (channels.includes('email')) {
      tiles.push(
        { label: 'Sent', value: s.sent.toLocaleString() },
        { label: 'Delivered', value: s.delivered > 0 ? s.delivered.toLocaleString() : '—', sub: s.delivered > 0 ? pct(s.delivered) : 'not tracked yet' },
        { label: 'Opened', value: s.uniqueOpens.toLocaleString(), sub: pct(s.uniqueOpens) + (s.uniqueOpens > 0 ? ' · approx.' : '') },
        { label: 'Clicked', value: s.clicks.toLocaleString(), sub: pct(s.clicks) }
      );
    }
    if (channels.includes('web')) {
      tiles.push(
        { label: 'Popup Shown', value: s.webShown.toLocaleString() },
        { label: 'Popup Clicked', value: s.webClicks.toLocaleString() }
      );
    }
    tiles.push({
      label: 'Purchased',
      value: s.purchases > 0 ? s.purchases.toLocaleString() : '—',
      sub: s.purchases > 0 ? '$' + Math.round(s.revenue).toLocaleString() : 'not tracked yet'
    });
    return tiles;
  }

  touchOpenRate(touch: CampaignEmailModel): string {
    return touch.stats.sent > 0 ? Math.round((touch.stats.uniqueOpens / touch.stats.sent) * 100) + '%' : '';
  }

  canOpenInDesigner(): boolean {
    // The designer rides System Templates' grants (see EmailDesignerComponent).
    return this.permissionService.canAdd('tools-manager.system-templates');
  }

  canEditCampaign(): boolean {
    return this.permissionService.canEdit('campaigns-manager.campaigns');
  }

  canAddEmail(): boolean {
    // Web-only campaigns don't author emails - re-open the wizard and add
    // the email channel first.
    return (this.campaign.channels ?? []).includes('email') &&
      this.permissionService.canAdd('campaigns-manager.campaigns');
  }

  isEditableTouch(touch: CampaignEmailModel): boolean {
    return (touch.status === 'draft' || touch.status === 'scheduled') && this.canEditCampaign();
  }

  // An email that never went out can be deleted outright (2026-08-21).
  // Deliberately the same set the timeline lets you EDIT - draft and
  // scheduled - because "not sent" is the real criterion and a scheduled
  // touch is simply one the hourly scheduler has not reached yet; deleting
  // it is how you call a planned send off. Never 'sending' (its ledger is
  // mid-drain and deleting the touch would strand it) and never 'sent'
  // (that is history, and it may be published to the public site).
  canDeleteTouch(touch: CampaignEmailModel): boolean {
    return (touch.status === 'draft' || touch.status === 'scheduled') &&
      this.permissionService.canDelete('campaigns-manager.campaigns');
  }

  async deleteTouch(touch: CampaignEmailModel): Promise<void> {
    if (!this.canDeleteTouch(touch)) {
      return;
    }
    const name = touch.label || touch.subject || 'this email';
    const scheduled = touch.status === 'scheduled';
    const confirmed = await this.confirmService.confirm(
      `Delete <b>${name}</b>?` +
      (scheduled ? ' It is scheduled to send, and deleting it cancels that send.' : '') +
      ' This cannot be undone.',
      'Delete Email'
    );
    if (!confirmed) {
      return;
    }
    try {
      await this.emailService.delete(touch.id!);
      this.snackbar.success('Email deleted');
      this.loadTouches();
    } catch (err) {
      this.snackbar.error('Delete failed: ' + ((err as Error)?.message ?? err));
    }
  }

  // Both routes leave this screen for the full-screen campaign email
  // editor (2026-08-21) - designing and scheduling happen together there,
  // so there is no longer an in-page 'editTouch' mode. Coming back is an
  // ordinary navigation to ?campaignId=, which reloads the timeline and
  // the header counters from scratch - that is why the old
  // onEditorClosed() refresh is gone rather than moved.
  newEmail(): void {
    this.router.navigate(['/campaigns-manager/email', this.campaign.id, 'new']);
  }

  editTouch(touch: CampaignEmailModel): void {
    if (!this.isEditableTouch(touch)) {
      return;
    }
    this.router.navigate(['/campaigns-manager/email', this.campaign.id, touch.id]);
  }

  touchStatusLabel(touch: CampaignEmailModel): string {
    if (touch.status === 'sending') {
      return `SENDING ${touch.stats.sent}/${touch.recipientCount ?? '?'}`;
    }
    return (touch.status ?? 'sent').toUpperCase();
  }

  // ---- Web popup (Phase 5) ----

  private loadPopup(): void {
    this.popupService.getById(this.campaign.id!).then((popup) => {
      this.popup = popup ?? null;
    });
  }

  editPopup(): void {
    if (!this.canEditCampaign()) {
      return;
    }
    this.mode = 'editPopup';
  }

  onPopupClosed(saved: boolean): void {
    this.mode = 'view';
    if (saved) {
      this.loadPopup();
      this.campaignService.getById(this.campaign.id!).then((fresh) => {
        if (fresh) {
          this.campaign = fresh;
        }
      });
    }
  }

  // ---- Social posts (assisted-manual publishing, 2026-08-20) ----

  // Deliberately not permission-gated for viewing - the composer itself
  // only writes on Save/Mark-Posted, and those go through CampaignService
  // like every other campaign write.
  openSocial(): void {
    this.mode = 'social';
  }

  onSocialClosed(changed: boolean): void {
    this.mode = 'view';
    if (changed) {
      // Same reload pattern as onPopupClosed - marking a channel posted
      // adds it to campaign.channels, so the header chips need the fresh doc.
      this.campaignService.getById(this.campaign.id!).then((fresh) => {
        if (fresh) {
          this.campaign = fresh;
        }
      });
    }
  }

  preview(touch: CampaignEmailModel): void {
    this.dialog.open(SentEmailPreviewDialogComponent, {
      width: '96vw',
      maxWidth: '900px',
      height: '90vh',
      data: { title: touch.label || this.campaign.name, subject: touch.subject, html: touch.html }
    });
  }

  openInDesigner(touch: CampaignEmailModel): void {
    this.router.navigate(['/tools-manager/email-designer/new'], { queryParams: { fromEmail: touch.id } });
  }

  // Public newsletter archive: a sent (or sending) touch can be shown on
  // the web app's Monthly Newsletter page - see CampaignEmailModel's
  // publishToWeb comment. Drafts/scheduled have nothing final to show.
  canPublishToWeb(touch: CampaignEmailModel): boolean {
    return (touch.status === 'sent' || touch.status === 'sending') && this.canEditCampaign();
  }

  publishToWeb(touch: CampaignEmailModel): void {
    if (!this.canPublishToWeb(touch)) {
      return;
    }
    this.dialog.open(PublishWebDialogComponent, {
      width: '520px',
      data: { touch }
    }).afterClosed().subscribe((saved) => {
      if (saved) {
        this.loadTouches();
      }
    });
  }

  back(): void {
    this.closed.emit();
  }

  canDeleteCampaign(): boolean {
    return this.permissionService.canDelete('campaigns-manager.campaigns');
  }

  // ---- Status lifecycle (2026-08-22) ----
  // Until now nothing in the app could move a campaign off draft: the wizard
  // wrote `status: campaign?.status ?? 'draft'` and no other path ever wrote
  // live or scheduled, so every campaign made in the UI stayed a draft forever
  // and the Live Now hub sat empty. These two actions are that missing
  // lifecycle - and they are what the offer hangs off, since a draft campaign
  // must never discount anything.

  canActivate(): boolean {
    if (!this.canEditCampaign()) {
      return false;
    }
    const status = effectiveStatus(this.campaign);
    return status === 'draft' || status === 'scheduled';
  }

  canEnd(): boolean {
    return this.canEditCampaign() && effectiveStatus(this.campaign) !== 'ended';
  }

  /**
   * Puts the campaign live, warning first about anything it would collide with.
   *
   * A start date in the future means SCHEDULED rather than live -
   * effectiveStatus() promotes it on its own when the date arrives, so nobody
   * has to remember to come back and press this again.
   */
  async activate(): Promise<void> {
    if (!this.canActivate()) {
      return;
    }

    // One live campaign per product/event. This is the real gate: drafts do
    // NOT reserve a target, so you can build several and are only stopped
    // here, at the moment one would actually go live.
    const targetId = this.campaign.goal === 'product'
      ? this.campaign.productId
      : this.campaign.eventId;
    const holder = await this.campaignService.findLiveCampaignFor(
      this.campaign.goal, targetId, this.campaign.id);
    if (holder) {
      const noun = this.campaign.goal === 'product' ? 'product' : 'event';
      const open = await this.confirmService.confirm(
        `<b>${holder.name}</b> is already live for this ${noun}, and only one ` +
        'campaign can promote it at a time. End that one first.' +
        '<br><br>Open it now?',
        'Already promoted');
      if (open) {
        this.router.navigate(['/campaigns-manager'],
          { queryParams: { tab: 'campaigns', campaignId: holder.id } });
      }
      return;
    }

    const conflict = await this.describeConflicts();
    if (conflict) {
      const proceed = await this.confirmService.confirm(conflict, 'Overlapping discount');
      if (!proceed) {
        return;
      }
    }

    const startMs = toMillis(this.campaign.startDate);
    const next: CampaignStatus = startMs > Date.now() ? 'scheduled' : 'live';

    try {
      // The published offer carries its OWN active flag - the storefront
      // cannot read a campaign to find out whether one is running. Only a
      // genuinely live campaign discounts; a scheduled one waits.
      const offer = await this.offerService.forCampaign(this.campaign.id!);

      // ONE batch, so the campaign and its offer move together or not at
      // all. These used to be two sequential awaits with the status chip
      // flipping optimistically between them: navigating away in that window
      // - or any failure on the second write - left the campaign live
      // advertising a discount that had never started. Nothing recomputed it
      // afterwards, so the only symptom was a shopper being charged full
      // price on a campaign that said it was running.
      const batch = this.campaignService.dao.batch();
      this.campaignService.dao.batchUpdateFields(
        batch, this.campaign.id!, 'campaigns', { status: next }
      );
      if (offer) {
        this.campaignService.dao.batchUpdateFields(
          batch, this.campaign.id!, 'campaign_offers', { isActive: next === 'live' }
        );
      }
      await batch.commit();

      // Only reflected locally once the write actually landed.
      this.campaign.status = next;

      this.snackbar.success(next === 'live' ? 'Campaign is live' : 'Campaign scheduled');
    } catch (err) {
      this.snackbar.error('Could not activate: ' + ((err as Error)?.message ?? err));
    }
  }

  /**
   * Ends the campaign and everything it is still doing.
   *
   * The cascade is the whole point: a campaign marked ended whose popup keeps
   * showing and whose discount keeps applying is worse than no button at all.
   * Each step after the status write is best-effort and reported by name, so a
   * single failure cannot leave the campaign ended with its discount live and
   * nobody told.
   */
  async endCampaign(): Promise<void> {
    if (!this.canEnd()) {
      return;
    }
    const confirmed = await this.confirmService.confirm(
      'Ending this campaign stops its web popup, its discount and its coupon. ' +
        'Emails already sent are unaffected, and nothing is deleted.',
      'End Campaign'
    );
    if (!confirmed) {
      return;
    }

    const endedAt = new Date();
    try {
      await this.campaignService.updateFields(this.campaign.id!, {
        status: 'ended',
        endDate: endedAt
      });
      this.campaign.status = 'ended';
      this.campaign.endDate = endedAt;
    } catch (err) {
      this.snackbar.error('Could not end the campaign: ' + ((err as Error)?.message ?? err));
      return;
    }

    const failures: string[] = [];

    if (this.popup) {
      try {
        await this.popupService.updateFields(this.campaign.id!, { isActive: false });
        this.popup.isActive = false;
      } catch {
        failures.push('popup');
      }
    }

    try {
      const offer = await this.offerService.forCampaign(this.campaign.id!);
      if (offer) {
        await this.offerService.deactivate(this.campaign.id!);
      }
    } catch {
      failures.push('discount');
    }

    if (this.campaign.couponId) {
      try {
        await this.couponService.updateFields(this.campaign.couponId, { isActive: false });
      } catch {
        failures.push('coupon');
      }
    }

    if (failures.length) {
      this.snackbar.error(
        'Campaign ended, but could not stop its ' + failures.join(' or ') + ' - check it by hand.'
      );
    } else {
      this.snackbar.success('Campaign ended');
    }
  }

  /**
   * A human sentence naming what this campaign's discount would collide with,
   * or null when nothing.
   *
   * Overlapping DISCOUNTS only. Two campaigns promoting the same thing is good
   * marketing, and warning about that would train people to click through the
   * warning without reading it.
   */
  private async describeConflicts(): Promise<string | null> {
    const offer = await this.offerService.forCampaign(this.campaign.id!);
    if (!offer?.target) {
      return null;
    }

    // The catalogue is needed to decide whether a product sits inside a
    // discounted series - the check has to resolve that both ways round.
    const products = await this.productService.getAll();
    const seriesOf = (productId: string): string | null =>
      products.find((p) => p.id === productId)?.series ?? null;

    const clashes = await this.offerService.findConflicts(
      this.campaign.id!,
      offer.target,
      seriesOf
    );
    if (!clashes.length) {
      return null;
    }

    const names = await Promise.all(
      clashes.map(async (c) => (await this.campaignService.getById(c.campaignId))?.name ?? c.campaignId)
    );

    return (
      'Already discounted by ' + names.map((n) => '"' + n + '"').join(' and ') + '. ' +
      'A shopper gets the better of the two prices. Put this campaign live anyway?'
    );
  }

  // Same cascade + confirm as the list row action (CampaignsComponent.
  // deleteCampaign) - kept in sync through describeCampaignDelete().
  async deleteCampaign(): Promise<void> {
    if (!this.canDeleteCampaign()) {
      return;
    }
    try {
      const plan = await this.campaignService.planDelete(this.campaign.id!);
      if (plan.inFlight.length > 0) {
        this.snackbar.error(`Cannot delete while emails are sending or scheduled: ${plan.inFlight.join(', ')}`);
        return;
      }
      const confirmed = await this.confirmService.confirm(describeCampaignDelete(this.campaign, plan), 'Delete Campaign');
      if (!confirmed) {
        return;
      }
      const result = await this.campaignService.deleteCascade(this.campaign.id!);
      this.snackbar.success(describeCampaignDeleteResult(result));
      this.deleted.emit();
    } catch (err) {
      this.snackbar.error('Delete failed: ' + ((err as Error)?.message ?? err));
    }
  }
}
