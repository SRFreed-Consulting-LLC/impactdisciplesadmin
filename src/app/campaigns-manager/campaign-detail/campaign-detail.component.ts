import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { CampaignModel, campaignKindLabel, channelLabel, effectiveStatus } from 'src/app/common/models/domain/campaign.model';
import { CampaignEmailModel } from 'src/app/common/models/domain/campaign-email.model';
import { CampaignEmailService } from 'src/app/common/services/data/campaign-email.service';
import { CampaignService } from 'src/app/common/services/data/campaign.service';
import { CampaignPopupModel } from 'src/app/common/models/domain/campaign-popup.model';
import { CampaignPopupService } from 'src/app/common/services/data/campaign-popup.service';
import { ProductService } from 'src/app/common/services/data/product.service';
import { EventService } from 'src/app/common/services/data/event.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { QueryParam, WhereFilterOperandKeys } from 'src/app/common/dao/firebase.dao';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { SentEmailPreviewDialogComponent } from '../sent-emails/sent-email-preview-dialog.component';

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

  mode: 'view' | 'editTouch' | 'editPopup' | 'social' = 'view';
  editingTouch: CampaignEmailModel | null = null;

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
    private productService: ProductService,
    private eventService: EventService,
    private permissionService: PermissionService,
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
    // The designer rides Email Templates' grants (see EmailDesignerComponent).
    return this.permissionService.canAdd('tools-manager.email-templates');
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

  newEmail(): void {
    this.editingTouch = null;
    this.mode = 'editTouch';
  }

  editTouch(touch: CampaignEmailModel): void {
    if (!this.isEditableTouch(touch)) {
      return;
    }
    this.editingTouch = touch;
    this.mode = 'editTouch';
  }

  onEditorClosed(saved: boolean): void {
    this.mode = 'view';
    this.editingTouch = null;
    if (saved) {
      this.loadTouches();
      // Sends bump the campaign's own counters - refresh the header too.
      this.campaignService.getById(this.campaign.id!).then((fresh) => {
        if (fresh) {
          this.campaign = fresh;
        }
      });
    }
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

  back(): void {
    this.closed.emit();
  }
}
