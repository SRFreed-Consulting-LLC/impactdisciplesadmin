import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { CampaignEmailModel } from 'src/app/common/models/domain/campaign-email.model';
import { CampaignService } from 'src/app/common/services/data/campaign.service';
import { CampaignEmailService } from 'src/app/common/services/data/campaign-email.service';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { PagedCollectionSource } from '../../shared/paged-collection-source';
import { dateFromTimestamp } from '@impact-common/shared/utils/date-from-timestamp';
import { SentEmailPreviewDialogComponent } from './sent-email-preview-dialog.component';

// Sent Emails - the global EMAIL LOG (Campaign Manager v2): every email
// touch across every campaign, newest first, straight off campaign_emails.
// This screen answers "what went out lately?" across all of them; the
// campaign DETAIL view is where a single effort's story lives.
//
// A purely HISTORICAL account (2026-08-21): preview only, never edit or
// re-send. It stopped being a left-nav leaf of its own and is now hosted
// in-page by the Campaigns screen (a 'Sent Emails' button in that screen's
// grid header), which is why it emits `closed` for a back button and
// `openCampaign` instead of routing anywhere itself. Clicking a row goes
// straight to that email's campaign; the eye icon previews the email.
//
// The old "open in designer" row action is gone with the nav leaf - the
// designer's own template picker has a 'Past Emails' section that pages
// this same collection with live previews, which is the better surface for
// "start from something we already sent" (and the only one now).
//
// (Rows carry their ~25KB html snapshot - a 50-row page is ~1.2MB,
// acceptable for a one-time paged fetch.)
@Component({
    selector: 'app-sent-emails',
    templateUrl: './sent-emails.component.html',
    styleUrls: ['./sent-emails.component.scss'],
    standalone: false
})
export class SentEmailsComponent implements OnInit {
  /** Back to the hosting Campaigns list. */
  @Output() closed = new EventEmitter<void>();
  /** Row click - the host opens this campaign's detail view. */
  @Output() openCampaign = new EventEmitter<string>();

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
    { icon: 'visibility', tooltip: 'PREVIEW', onClick: (item) => this.preview(item) }
  ];

  paged: PagedCollectionSource<CampaignEmailModel>;

  // One-time id -> name map for the Campaign column (~150 docs post-regroup).
  private campaignNames = new Map<string, string>();

  constructor(
    private emailService: CampaignEmailService,
    private campaignService: CampaignService,
    private dialog: MatDialog
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

  back(): void {
    this.closed.emit();
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

  // Straight to the campaign this email belongs to - the host swaps to its
  // detail view in place. Guarded because the action icons stopPropagation
  // but a row could still, in principle, carry no campaignId.
  rowClicked(item: CampaignEmailModel): void {
    if (item.campaignId) {
      this.openCampaign.emit(item.campaignId);
    }
  }
}
