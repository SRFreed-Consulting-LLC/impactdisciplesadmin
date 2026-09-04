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
import { liveTargetConflict, runCampaignDelete } from '../campaign-lifecycle';

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
    return this.permissionService.canAdd('tools-manager.email-designer');
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
    // fromCampaign is what the designer's Back button uses to return HERE.
    // Without it the designer falls back to System Templates - which is
    // where it lives, but not where the person came from, so editing a
    // campaign email used to strand you on an unrelated screen.
    this.router.navigate(['/tools-manager/email-designer/new'], {
      queryParams: { fromEmail: touch.id, fromCampaign: this.campaign.id }
    });
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
    // 'ended' is here as of 2026-09-04, and its absence was a dead end: END
    // CAMPAIGN hides itself once a campaign is ended and ACTIVATE only offered
    // itself to drafts, so an ended campaign showed NEITHER button and nothing
    // else in the app writes `status`. Reopening one meant editing Firestore by
    // hand, which is what actually happened to the Golf Tournament campaign
    // before a send.
    return status === 'draft' || status === 'scheduled' || status === 'ended';
  }

  /** Reopening an ended campaign, rather than starting a fresh one. */
  isReopen(): boolean {
    return effectiveStatus(this.campaign) === 'ended';
  }

  /** REOPEN reads differently from ACTIVATE, and the distinction is real. */
  activateLabel(): string {
    return this.isReopen() ? 'REOPEN' : 'ACTIVATE';
  }

  activateTooltip(): string {
    return this.isReopen() ?
      'Put this campaign back to live so it can send again' :
      'Start this campaign - its popup and discount begin';
  }

  /**
   * True when the end date is the ONLY thing keeping this campaign ended.
   *
   * effectiveStatus() derives 'ended' from a past endDate as well as from the
   * stored field, so writing status:'live' on its own would be read straight
   * back as 'ended' and the button would look broken. The date has to go with
   * it - see activate().
   */
  private endDateHasPassed(): boolean {
    const end = this.campaign.endDate ? toMillis(this.campaign.endDate) : 0;
    return end > 0 && end < Date.now();
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
    // here, at the moment one would actually go live. (R1: shared with the
    // wizard's save - the two wordings had already drifted apart.)
    const blocked = await liveTargetConflict(
      {
        campaignService: this.campaignService,
        confirmService: this.confirmService,
        router: this.router
      },
      this.campaign
    );
    if (blocked) {
      return;
    }

    const conflict = await this.describeConflicts();
    if (conflict) {
      const proceed = await this.confirmService.confirm(conflict, 'Overlapping discount');
      if (!proceed) {
        return;
      }
    }

    // A past end date would re-derive 'ended' the instant we wrote 'live', so
    // reopening has to clear it or the button silently does nothing. Asked
    // rather than assumed: the end date is a real editorial decision, and
    // wiping one without saying so is its own surprise.
    const clearEndDate = this.isReopen() && this.endDateHasPassed();
    if (clearEndDate) {
      const when = dateFromTimestamp(this.campaign.endDate as never);
      const proceed = await this.confirmService.confirm(
        `This campaign ended on <b>${when ? when.toLocaleDateString('en-US') : 'a past date'}</b>. ` +
        'Reopening will clear that end date so it stays live until you end it again. ' +
        'Set a new end date afterwards with EDIT CAMPAIGN if you want one.',
        'Reopen campaign'
      );
      if (!proceed) {
        return;
      }
    }

    const startMs = toMillis(this.campaign.startDate);
    const next: CampaignStatus = startMs > Date.now() ? 'scheduled' : 'live';

    try {
      // R1: the campaign-and-its-offer batch lives on CampaignService now -
      // see activateTo(), which carries the reasoning for why it must stay
      // ONE batch. This screen keeps only what is UI.
      await this.campaignService.activateTo(this.campaign.id!, next, { clearEndDate });

      // Only reflected locally once the write actually landed.
      this.campaign.status = next;
      if (clearEndDate) {
        this.campaign.endDate = null;
      }

      this.snackbar.success(this.reopenedMessage(next, clearEndDate));
    } catch (err) {
      this.snackbar.error('Could not activate: ' + ((err as Error)?.message ?? err));
    }
  }

  /**
   * What to say after the write landed. Separate so the wording is testable
   * without a component fixture.
   * @param next The status written.
   * @param clearedEndDate Whether the stale end date was removed with it.
   * @returns The snackbar text.
   */
  private reopenedMessage(next: CampaignStatus, clearedEndDate: boolean): string {
    if (next === 'scheduled') {
      return 'Campaign scheduled';
    }
    return clearedEndDate ?
      'Campaign reopened - it is live with no end date' :
      'Campaign is live';
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

    // R1: the four-collection cascade lives on CampaignService now - see
    // endCascade(), which throws if the status write fails and otherwise
    // returns the names of anything it could not stop.
    let failures: string[];
    try {
      failures = await this.campaignService.endCascade(this.campaign, endedAt);
      this.campaign.status = 'ended';
      this.campaign.endDate = endedAt;
      if (this.popup) {
        this.popup.isActive = false;
      }
    } catch (err) {
      this.snackbar.error('Could not end the campaign: ' + ((err as Error)?.message ?? err));
      return;
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
    // R1: the plan/confirm/delete flow is shared with the list screen (it
    // was two verbatim copies). Only what happens AFTER differs.
    const deleted = await runCampaignDelete(
      {
        campaignService: this.campaignService,
        confirmService: this.confirmService,
        snackbar: this.snackbar
      },
      this.campaign
    );
    if (deleted) {
      this.deleted.emit();
    }
  }
}
