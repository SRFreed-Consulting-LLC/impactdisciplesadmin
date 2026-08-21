import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CampaignModel, CampaignStatus, campaignKindLabel, effectiveStatus } from 'src/app/common/models/domain/campaign.model';
import { CampaignService } from 'src/app/common/services/data/campaign.service';
import { dateFromTimestamp, toMillis } from '@impact-common/shared/utils/date-from-timestamp';

// Status Board (kept in v2 by user choice, adapted to goal/channels): the
// same campaign docs as the Campaigns list, arranged two ways behind one
// toggle - a lifecycle board (Draft / Scheduled / Live / Ended) and a
// month calendar (each campaign a colored bar across its date range).
// Once sends exist again (Phase 2), the calendar doubles as the planned-
// sends / popup-windows view. A card opens the campaign DETAIL on the
// Campaigns tab (?campaignId= deep link) - the v1 composer hosting is gone.
@Component({
    selector: 'app-status-board',
    templateUrl: './status-board.component.html',
    styleUrls: ['./status-board.component.scss'],
    standalone: false
})
export class StatusBoardComponent implements OnInit {
  view: 'board' | 'calendar' = 'board';

  campaigns: CampaignModel[] = [];
  loading = true;

  // How many ended campaigns the board shows before deferring to the list
  // screen - with the whole regrouped history 'ended', this matters more
  // than ever: the board is a "what's happening" surface, not an archive.
  private readonly endedLimit = 2;

  columnsConfig: { status: CampaignStatus; label: string }[] = [
    { status: 'draft', label: 'Draft' },
    { status: 'scheduled', label: 'Scheduled' },
    { status: 'live', label: 'Live' },
    { status: 'ended', label: 'Ended' }
  ];

  monthCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  readonly dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  kindLabel = campaignKindLabel;
  toDate = dateFromTimestamp;

  constructor(
    private service: CampaignService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.load();
  }

  // One-time getAll() - the campaign collection is ~150 docs post-regroup
  // and this screen re-derives everything (columns, calendar bars) from
  // the one array.
  private load(): void {
    this.loading = true;
    this.service.getAll().then((campaigns) => {
      this.campaigns = campaigns;
      this.loading = false;
    });
  }

  column(status: CampaignStatus): CampaignModel[] {
    const items = this.campaigns.filter((c) => effectiveStatus(c) === status);
    if (status === 'draft') {
      return items.sort((a, b) => a.name.localeCompare(b.name));
    }
    if (status === 'ended') {
      return items.sort((a, b) => toMillis(b.endDate ?? b.startDate) - toMillis(a.endDate ?? a.startDate));
    }
    // scheduled by soonest start, live by soonest end - "what needs
    // attention next" floats to the top of both.
    const field = status === 'scheduled' ? 'startDate' : 'endDate';
    return items.sort((a, b) => toMillis(a[field]) - toMillis(b[field]));
  }

  visibleColumn(status: CampaignStatus): CampaignModel[] {
    const items = this.column(status);
    return status === 'ended' ? items.slice(0, this.endedLimit) : items;
  }

  hiddenEndedCount(): number {
    return Math.max(0, this.column('ended').length - this.endedLimit);
  }

  metricLine(c: CampaignModel): string {
    const status = effectiveStatus(c);
    if (status === 'draft' || status === 'scheduled' || c.stats.sent === 0) {
      return '';
    }
    return `${c.stats.sent.toLocaleString()} sent · ${c.stats.uniqueOpens.toLocaleString()} opens`;
  }

  // ---- Calendar ----

  get monthCells(): (Date | null)[] {
    const year = this.monthCursor.getFullYear();
    const month = this.monthCursor.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const offset = new Date(year, month, 1).getDay();

    return [
      ...Array.from({ length: offset }, () => null),
      ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1))
    ];
  }

  prevMonth(): void {
    this.monthCursor = new Date(this.monthCursor.getFullYear(), this.monthCursor.getMonth() - 1, 1);
  }

  nextMonth(): void {
    this.monthCursor = new Date(this.monthCursor.getFullYear(), this.monthCursor.getMonth() + 1, 1);
  }

  // A campaign spans a day when its range overlaps it. A LONG-RUNNING
  // series (null endDate, e.g. the regrouped Prayer Letter) would paint a
  // bar on every day forever - so for ended campaigns the missing end
  // falls back to the start, and only genuinely live/scheduled open-ended
  // campaigns run on.
  campaignsOn(day: Date): CampaignModel[] {
    const dayStart = day.getTime();
    const dayEnd = dayStart + 86399999;

    return this.campaigns.filter((c) => {
      const start = toMillis(c.startDate);
      if (!start) {
        return false;
      }
      const end = toMillis(c.endDate) ||
        (effectiveStatus(c) === 'ended' ? start : Number.MAX_SAFE_INTEGER);
      return start <= dayEnd && end >= dayStart;
    });
  }

  get campaignsInMonth(): CampaignModel[] {
    const year = this.monthCursor.getFullYear();
    const month = this.monthCursor.getMonth();
    const monthStart = new Date(year, month, 1).getTime();
    const monthEnd = new Date(year, month + 1, 0).getTime() + 86399999;

    return this.campaigns.filter((c) => {
      const start = toMillis(c.startDate);
      if (!start) {
        return false;
      }
      const end = toMillis(c.endDate) ||
        (effectiveStatus(c) === 'ended' ? start : Number.MAX_SAFE_INTEGER);
      return start <= monthEnd && end >= monthStart;
    });
  }

  get unscheduledDrafts(): CampaignModel[] {
    return this.campaigns.filter((c) => effectiveStatus(c) === 'draft' && !toMillis(c.startDate));
  }

  // ---- Navigation ----

  goToList(): void {
    this.router.navigate(['/campaigns-manager'], { queryParams: { tab: 'campaigns' } });
  }

  openDetail(item: CampaignModel): void {
    this.router.navigate(['/campaigns-manager'], { queryParams: { tab: 'campaigns', campaignId: item.id } });
  }
}
