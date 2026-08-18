import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { CampaignModel, campaignKindLabel, effectiveStatus } from 'src/app/common/models/domain/campaign.model';
import { CampaignEmailModel } from 'src/app/common/models/domain/campaign-email.model';
import { CampaignEmailService } from 'src/app/common/services/data/campaign-email.service';
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
// designer). Read-only in Phase 1; editing/sending arrives with the wizard
// and send engine (Phase 2).
@Component({
    selector: 'app-campaign-detail',
    templateUrl: './campaign-detail.component.html',
    styleUrls: ['./campaign-detail.component.scss'],
    standalone: false
})
export class CampaignDetailComponent implements OnInit {
  @Input() campaign!: CampaignModel;
  @Output() closed = new EventEmitter<void>();

  touches: CampaignEmailModel[] = [];
  loadingTouches = true;

  // Resolved name of the promoted product/event, when the goal has one.
  promotesName = '';

  kindLabel = campaignKindLabel;
  effectiveStatus = effectiveStatus;
  toDate = dateFromTimestamp;

  constructor(
    private emailService: CampaignEmailService,
    private productService: ProductService,
    private eventService: EventService,
    private permissionService: PermissionService,
    private dialog: MatDialog,
    private router: Router
  ) {}

  ngOnInit(): void {
    // One page of 200 covers even the longest series (a 5-year monthly
    // newsletter is ~60 touches). Composite index (campaignId, sentAt DESC).
    this.emailService.getPage(200, null, 'sentAt', 'desc',
      [new QueryParam('campaignId', WhereFilterOperandKeys.equal, this.campaign.id)]
    ).then((page) => {
      this.touches = page.items;
      this.loadingTouches = false;
    });

    if (this.campaign.goal === 'product' && this.campaign.productId) {
      this.productService.getById(this.campaign.productId).then((p) => this.promotesName = p?.title ?? '');
    } else if (this.campaign.goal === 'event' && this.campaign.eventId) {
      this.eventService.getById(this.campaign.eventId).then((e) => this.promotesName = e?.eventName ?? '');
    }
  }

  get funnel(): FunnelTile[] {
    const s = this.campaign.stats;
    const pct = (part: number) => s.sent > 0 ? Math.round((part / s.sent) * 100) + '%' : '';
    const tiles: FunnelTile[] = [
      { label: 'Sent', value: s.sent.toLocaleString() },
      { label: 'Delivered', value: s.delivered > 0 ? s.delivered.toLocaleString() : '—', sub: s.delivered > 0 ? pct(s.delivered) : 'not tracked yet' },
      { label: 'Opened', value: s.uniqueOpens.toLocaleString(), sub: pct(s.uniqueOpens) + (s.uniqueOpens > 0 ? ' · approx.' : '') },
      { label: 'Clicked', value: s.clicks.toLocaleString(), sub: pct(s.clicks) },
      { label: 'Purchased', value: s.purchases > 0 ? s.purchases.toLocaleString() : '—', sub: s.purchases > 0 ? '$' + Math.round(s.revenue).toLocaleString() : 'not tracked yet' }
    ];
    if ((this.campaign.channels ?? []).includes('web')) {
      tiles.push(
        { label: 'Popup Shown', value: s.webShown.toLocaleString() },
        { label: 'Popup Clicked', value: s.webClicks.toLocaleString() }
      );
    }
    return tiles;
  }

  touchOpenRate(touch: CampaignEmailModel): string {
    return touch.stats.sent > 0 ? Math.round((touch.stats.uniqueOpens / touch.stats.sent) * 100) + '%' : '';
  }

  canOpenInDesigner(): boolean {
    // The designer rides Email Templates' grants (see EmailDesignerComponent).
    return this.permissionService.canAdd('tools-manager.email-templates');
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
