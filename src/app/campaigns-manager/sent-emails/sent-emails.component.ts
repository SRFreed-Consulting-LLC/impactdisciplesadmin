import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { CampaignEmailModel } from 'src/app/common/models/domain/campaign-email.model';
import { CampaignService } from 'src/app/common/services/data/campaign.service';
import { CampaignEmailService } from 'src/app/common/services/data/campaign-email.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { PagedCollectionSource } from '../../shared/paged-collection-source';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { SentEmailPreviewDialogComponent } from './sent-email-preview-dialog.component';

// Sent Emails - the global EMAIL LOG (Campaign Manager v2): every email
// touch across every campaign, newest first, straight off campaign_emails.
// The campaign column links context; the campaign DETAIL view is where a
// single effort's story lives - this screen answers "what went out
// lately?" across all of them. Read-only: preview or copy into the
// designer, never edit/re-send. (Rows carry their ~25KB html snapshot -
// a 50-row page is ~1.2MB, acceptable for a one-time paged fetch.)
@Component({
    selector: 'app-sent-emails',
    templateUrl: './sent-emails.component.html',
    styleUrls: ['./sent-emails.component.scss'],
    standalone: false
})
export class SentEmailsComponent implements OnInit {
  itemType = 'Sent Email';

  columns: DataGridColumn<CampaignEmailModel>[] = [
    { key: 'name', label: 'Email', value: (item) => item.label || item.subject },
    { key: 'subject', label: 'Subject', visible: false, value: (item) => item.subject },
    { key: 'campaign', label: 'Campaign', value: (item) => this.campaignName(item) },
    { key: 'sent', label: 'Sent', type: 'date', value: (item) => dateFromTimestamp(item.sentAt) },
    { key: 'recipients', label: 'Recipients', type: 'number', value: (item) => item.stats.sent },
    { key: 'opens', label: 'Opens', type: 'number', value: (item) => item.stats.uniqueOpens },
    { key: 'openRate', label: 'Open %', type: 'number', value: (item) => this.openRate(item) },
    { key: 'clicks', label: 'Clicks', type: 'number', value: (item) => item.stats.clicks }
  ];

  rowActions: DataGridRowAction<CampaignEmailModel>[] = [
    { icon: 'visibility', tooltip: 'PREVIEW', onClick: (item) => this.preview(item) },
    {
      icon: 'campaign', tooltip: 'VIEW CAMPAIGN', onClick: (item) => this.openCampaign(item),
      visible: (item) => !!item.campaignId
    },
    {
      icon: 'brush', tooltip: 'OPEN IN DESIGNER', onClick: (item) => this.openInDesigner(item),
      // The designer rides Email Templates' grants (see EmailDesignerComponent).
      visible: () => this.permissionService.canAdd('tools-manager.email-templates')
    }
  ];

  paged: PagedCollectionSource<CampaignEmailModel>;

  // One-time id -> name map for the Campaign column (~150 docs post-regroup).
  private campaignNames = new Map<string, string>();

  constructor(
    private emailService: CampaignEmailService,
    private campaignService: CampaignService,
    private permissionService: PermissionService,
    private dialog: MatDialog,
    private router: Router
  ) {
    // Newest first. Plain orderBy sentAt - docs missing sentAt (future
    // drafts) are excluded by Firestore's orderBy semantics, which is
    // exactly right for a SENT log.
    this.paged = new PagedCollectionSource<CampaignEmailModel>(
      (pageSize, cursor) => this.emailService.getPage(pageSize, cursor, 'sentAt', 'desc'),
      50
    );
  }

  ngOnInit(): void {
    this.campaignService.getAll().then((campaigns) => {
      for (const campaign of campaigns) {
        this.campaignNames.set(campaign.id!, campaign.name);
      }
    });
    this.paged.loadFirstPage();
  }

  private campaignName(item: CampaignEmailModel): string {
    return this.campaignNames.get(item.campaignId) ?? '';
  }

  private openRate(item: CampaignEmailModel): number {
    return item.stats.sent > 0 ? Math.round((item.stats.uniqueOpens / item.stats.sent) * 100) : 0;
  }

  preview(item: CampaignEmailModel): void {
    this.dialog.open(SentEmailPreviewDialogComponent, {
      width: '96vw',
      maxWidth: '900px',
      height: '90vh',
      data: { title: item.label || this.campaignName(item) || item.subject, subject: item.subject, html: item.html }
    });
  }

  openCampaign(item: CampaignEmailModel): void {
    this.router.navigate(['/campaigns-manager'], { queryParams: { tab: 'campaigns', campaignId: item.campaignId } });
  }

  // Start a NEW design from this email's html - the designer reads
  // ?fromEmail and seeds a copy via createDesignFromFullHtml(); the sent
  // record itself is never touched.
  openInDesigner(item: CampaignEmailModel): void {
    this.router.navigate(['/tools-manager/email-designer/new'], { queryParams: { fromEmail: item.id } });
  }
}
