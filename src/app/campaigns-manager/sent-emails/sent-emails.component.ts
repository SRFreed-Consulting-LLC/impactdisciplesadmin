import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { CampaignModel } from 'src/app/common/models/domain/campaign.model';
import { CampaignService } from 'src/app/common/services/data/campaign.service';
import { CampaignEmailService } from 'src/app/common/services/data/campaign-email.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { PagedCollectionSource } from '../../shared/paged-collection-source';
import { QueryParam, WhereFilterOperandKeys } from 'src/app/common/dao/firebase.dao';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { SentEmailPreviewDialogComponent } from './sent-email-preview-dialog.component';

// Sent Emails: the email-campaign HISTORY - every one-shot email that
// already went out (today: the whole Mailchimp archive, imported by
// scripts/import-mailchimp-campaigns.js as type 'email' campaigns; later:
// this app's own one-time sends). Read-only by design - a sent email can be
// previewed or copied into the designer, never edited or re-sent from here.
// The working Campaigns list and Status Board exclude this type entirely
// (ACTIVE_CAMPAIGN_TYPES) so 477 historical rows never drown live work.
@Component({
    selector: 'app-sent-emails',
    templateUrl: './sent-emails.component.html',
    styleUrls: ['./sent-emails.component.scss'],
    standalone: false
})
export class SentEmailsComponent implements OnInit {
  itemType = 'Sent Email';

  private readonly screenKey = 'campaigns-manager.sent-emails';

  columns: DataGridColumn<CampaignModel>[] = [
    { key: 'name', label: 'Name' },
    { key: 'subject', label: 'Subject', value: (item) => item.subject ?? '' },
    { key: 'sent', label: 'Sent', type: 'date', value: (item) => dateFromTimestamp(item.startDate) },
    { key: 'recipients', label: 'Recipients', type: 'number', value: (item) => item.stats.emailsSent },
    { key: 'opens', label: 'Opens', type: 'number', value: (item) => item.stats.uniqueOpens ?? 0 },
    { key: 'openRate', label: 'Open %', type: 'number', value: (item) => this.openRate(item) },
    { key: 'clicks', label: 'Clicks', type: 'number', value: (item) => item.stats.linkClicks },
    { key: 'templateName', label: 'Started From', visible: false, value: (item) => item.templateName ?? '' }
  ];

  rowActions: DataGridRowAction<CampaignModel>[] = [
    { icon: 'visibility', tooltip: 'PREVIEW', onClick: (item) => this.preview(item) },
    {
      icon: 'brush', tooltip: 'OPEN IN DESIGNER', onClick: (item) => this.openInDesigner(item),
      // The designer rides Email Templates' grants (see EmailDesignerComponent)
      // - only offer the jump to someone it won't bounce.
      visible: () => this.permissionService.canAdd('tools-manager.email-templates')
    }
  ];

  paged: PagedCollectionSource<CampaignModel>;

  constructor(
    private service: CampaignService,
    private emailService: CampaignEmailService,
    private permissionService: PermissionService,
    private snackbar: SnackbarService,
    private dialog: MatDialog,
    private router: Router
  ) {
    // Newest first; composite index (type, startDate) backs the pair.
    this.paged = new PagedCollectionSource<CampaignModel>(
      (pageSize, cursor) => this.service.getPage(pageSize, cursor, 'startDate', 'desc',
        [new QueryParam('type', WhereFilterOperandKeys.equal, 'email')]),
      50
    );
  }

  ngOnInit(): void {
    this.paged.loadFirstPage();
  }

  private openRate(item: CampaignModel): number {
    const sent = item.stats.emailsSent;
    return sent > 0 ? Math.round(((item.stats.uniqueOpens ?? 0) / sent) * 100) : 0;
  }

  // The body html lives in campaign_emails (same doc id), fetched only now.
  preview(item: CampaignModel): void {
    this.emailService.getById(item.id!).then((email) => {
      if (!email?.html) {
        this.snackbar.error('No stored email body for this record.');
        return;
      }
      this.dialog.open(SentEmailPreviewDialogComponent, {
        width: '96vw',
        maxWidth: '900px',
        height: '90vh',
        panelClass: 'sent-email-preview-panel',
        data: { title: item.name, subject: item.subject ?? '', html: email.html }
      });
    });
  }

  // Start a NEW design from this email's html - the designer reads
  // ?fromEmail and seeds a copy via createDesignFromFullHtml(); the sent
  // record itself is never touched.
  openInDesigner(item: CampaignModel): void {
    this.router.navigate(['/tools-manager/email-designer/new'], { queryParams: { fromEmail: item.id } });
  }
}
