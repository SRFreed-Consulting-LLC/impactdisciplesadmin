import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, Observable, map, tap } from 'rxjs';
import { environment } from 'src/environments/environment';
import { CampaignEmailModel } from 'src/app/common/models/domain/campaign-email.model';
import { CampaignService } from 'src/app/common/services/data/campaign.service';
import { CampaignEmailService } from 'src/app/common/services/data/campaign-email.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { dateFromTimestamp, toMillis } from '@impact-common/shared/utils/date-from-timestamp';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { SentEmailPreviewDialogComponent } from '../sent-emails/sent-email-preview-dialog.component';
import { PublishWebDialogComponent } from '../campaign-detail/publish-web-dialog.component';

// Website Newsletters (2026-08-20): every email flagged publishToWeb, across
// ALL campaigns, newest first - i.e. exactly what the public site's Monthly
// Newsletter page lists (the newsletter_archive function serves the same
// set). Exists because the flag lives on the EMAIL, not the campaign: the
// published issues are spread over the Monthly Newsletter campaign, the
// Prayer Letter campaign and standalone sends, so no single campaign
// detail page answers "what's on the website right now?". Flags are SET
// from a campaign's detail page (globe icon) or the Subscriber Report send
// dialog; here you can review, re-title or unpublish.
@Component({
    selector: 'app-web-newsletters',
    templateUrl: './web-newsletters.component.html',
    styleUrls: ['./web-newsletters.component.scss'],
    standalone: false
})
export class WebNewslettersComponent implements OnInit {
  rows$: Observable<CampaignEmailModel[]>;
  loading$ = new BehaviorSubject<boolean>(true);

  columns: DataGridColumn<CampaignEmailModel>[] = [
    { key: 'title', label: 'Public Title', value: (item) => this.publicTitle(item) },
    { key: 'subject', label: 'Subject', visible: false, value: (item) => item.subject },
    { key: 'campaign', label: 'Campaign', value: (item) => this.campaignName(item) },
    { key: 'sent', label: 'Sent', type: 'date', value: (item) => dateFromTimestamp(item.sentAt) },
    { key: 'status', label: 'Status', value: (item) => (item.status ?? 'sent').toUpperCase() }
  ];

  headerActions: ListHeaderAction[] = [
    { label: 'Open Public Page', icon: 'open_in_new', onClick: () => this.openPublicPage() }
  ];

  rowActions: DataGridRowAction<CampaignEmailModel>[] = [
    { icon: 'visibility', tooltip: 'PREVIEW', onClick: (item) => this.preview(item) },
    { icon: 'open_in_new', tooltip: 'VIEW ON WEBSITE', onClick: (item) => this.openOnWebsite(item) },
    {
      icon: 'campaign', tooltip: 'VIEW CAMPAIGN', onClick: (item) => this.openCampaign(item),
      visible: (item) => !!item.campaignId
    },
    {
      icon: 'edit', tooltip: 'EDIT TITLE / UNPUBLISH', onClick: (item) => this.editPublish(item),
      visible: () => this.canEdit()
    }
  ];

  // One-time id -> name map for the Campaign column.
  private campaignNames = new Map<string, string>();

  constructor(
    private emailService: CampaignEmailService,
    private campaignService: CampaignService,
    private permissionService: PermissionService,
    private dialog: MatDialog,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.campaignService.getAll().then((campaigns) => {
      for (const campaign of campaigns) {
        this.campaignNames.set(campaign.id!, campaign.name);
      }
    });
    // Live stream so unpublishing from the dialog drops the row at once.
    // where(publishToWeb == true) alone needs no composite index; sorting
    // newest-first client-side (tens of rows, not thousands).
    this.rows$ = this.emailService.streamAllByValue('publishToWeb', true).pipe(
      map((rows) => [...rows].sort((a, b) => toMillis(b.sentAt) - toMillis(a.sentAt))),
      tap(() => this.loading$.next(false))
    );
  }

  // The flag is campaign data - same grant that sets it on campaign detail.
  canEdit(): boolean {
    return this.permissionService.canEdit('campaigns-manager.campaigns') ||
      this.permissionService.canEdit('campaigns-manager.website-newsletters');
  }

  publicTitle(item: CampaignEmailModel): string {
    return item.webTitle || item.label || item.subject || '(untitled)';
  }

  private campaignName(item: CampaignEmailModel): string {
    return this.campaignNames.get(item.campaignId) ?? '';
  }

  preview(item: CampaignEmailModel): void {
    this.dialog.open(SentEmailPreviewDialogComponent, {
      width: '96vw',
      maxWidth: '900px',
      height: '90vh',
      data: { title: this.publicTitle(item), subject: item.subject, html: item.html }
    });
  }

  openOnWebsite(item: CampaignEmailModel): void {
    window.open(`${environment.publicSiteUrl}/monthly-newsletter/${encodeURIComponent(item.id!)}`, '_blank', 'noopener');
  }

  openPublicPage(): void {
    window.open(`${environment.publicSiteUrl}/monthly-newsletter`, '_blank', 'noopener');
  }

  openCampaign(item: CampaignEmailModel): void {
    this.router.navigate(['/campaigns-manager'], { queryParams: { tab: 'campaigns', campaignId: item.campaignId } });
  }

  editPublish(item: CampaignEmailModel): void {
    if (!this.canEdit()) {
      return;
    }
    this.dialog.open(PublishWebDialogComponent, { width: '520px', data: { touch: item } });
  }
}
