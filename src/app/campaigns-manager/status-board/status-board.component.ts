import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CAMPAIGN_TYPE_LABELS, CampaignModel, CampaignStatus, CampaignType, effectiveStatus } from 'src/app/common/models/domain/campaign.model';
import { CampaignTemplate } from 'src/app/common/models/domain/campaign-template.model';
import { CampaignService } from 'src/app/common/services/data/campaign.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { dateFromTimestamp, toMillis } from 'src/app/common/utils/date-from-timestamp';

// Status Board: the same campaign docs as the Campaigns list, arranged two
// ways behind one toggle - a lifecycle board (Draft / Scheduled / Live /
// Ended) and a month calendar (each campaign a colored bar across its date
// range, so overlapping asks to the one shared subscriber list are visible
// before they happen). No data of its own - purely a different lens; a
// card/bar opens the same Composer, where Launch/End live.
@Component({
    selector: 'app-status-board',
    templateUrl: './status-board.component.html',
    styleUrls: ['./status-board.component.scss'],
    standalone: false
})
export class StatusBoardComponent implements OnInit {
  mode: 'board' | 'gallery' | 'edit' = 'board';
  view: 'board' | 'calendar' = 'board';
  typeFilter: 'all' | CampaignType = 'all';

  campaigns: CampaignModel[] = [];
  loading = true;

  // How many ended campaigns the board shows before deferring to the list
  // screen - the board is a "what's happening" surface, not an archive.
  private readonly endedLimit = 2;

  columnsConfig: { status: CampaignStatus; label: string }[] = [
    { status: 'draft', label: 'Draft' },
    { status: 'scheduled', label: 'Scheduled' },
    { status: 'live', label: 'Live' },
    { status: 'ended', label: 'Ended' }
  ];

  monthCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  readonly dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  private readonly screenKey = 'campaigns-manager.status-board';

  typeLabels = CAMPAIGN_TYPE_LABELS;
  toDate = dateFromTimestamp;

  editingCampaign: CampaignModel | null = null;
  pendingTemplate: CampaignTemplate | null = null;

  constructor(
    private service: CampaignService,
    private permissionService: PermissionService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.load();
  }

  // One-time getAll(), reloaded after every Composer save - campaigns is a
  // small collection and this screen re-derives everything (columns,
  // calendar bars, drafts strip) from the one array.
  private load(): void {
    this.loading = true;
    this.service.getAll().then((campaigns) => {
      this.campaigns = campaigns;
      this.loading = false;
    });
  }

  get canAdd(): boolean {
    return this.permissionService.canAdd(this.screenKey);
  }

  private get filtered(): CampaignModel[] {
    return this.campaigns.filter((c) => this.typeFilter === 'all' || c.type === this.typeFilter);
  }

  column(status: CampaignStatus): CampaignModel[] {
    const items = this.filtered.filter((c) => effectiveStatus(c) === status);
    if (status === 'draft') {
      return items.sort((a, b) => a.name.localeCompare(b.name));
    }
    if (status === 'ended') {
      return items.sort((a, b) => toMillis(b.endDate) - toMillis(a.endDate));
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
    if (status === 'draft' || status === 'scheduled') {
      return '';
    }
    if (c.type === 'product') {
      return `${c.stats.redemptions} redemptions`;
    }
    if (c.type === 'event') {
      return `${c.stats.registrations} registrations`;
    }
    return `${c.stats.leads} leads · ${c.stats.redemptions} redeemed`;
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

  // A campaign spans a day when its range overlaps it; no end date means
  // open-ended (the bar runs on until the campaign is ended). Drafts have
  // no start date, so they never reach the calendar - they sit in the
  // unscheduled strip below it instead.
  campaignsOn(day: Date): CampaignModel[] {
    const dayStart = day.getTime();
    const dayEnd = dayStart + 86399999;

    return this.filtered.filter((c) => {
      const start = toMillis(c.startDate);
      if (!start) {
        return false;
      }
      const end = toMillis(c.endDate) || Number.MAX_SAFE_INTEGER;
      return start <= dayEnd && end >= dayStart;
    });
  }

  get campaignsInMonth(): CampaignModel[] {
    const year = this.monthCursor.getFullYear();
    const month = this.monthCursor.getMonth();
    const monthStart = new Date(year, month, 1).getTime();
    const monthEnd = new Date(year, month + 1, 0).getTime() + 86399999;

    return this.filtered.filter((c) => {
      const start = toMillis(c.startDate);
      if (!start) {
        return false;
      }
      const end = toMillis(c.endDate) || Number.MAX_SAFE_INTEGER;
      return start <= monthEnd && end >= monthStart;
    });
  }

  get unscheduledDrafts(): CampaignModel[] {
    return this.filtered.filter((c) => effectiveStatus(c) === 'draft' && !toMillis(c.startDate));
  }

  // ---- Navigation / Composer hand-off ----

  goToList(): void {
    this.router.navigate(['/campaigns-manager'], { queryParams: { tab: 'campaigns' } });
  }

  showGallery(): void {
    if (!this.canAdd) {
      return;
    }
    this.mode = 'gallery';
  }

  onTemplatePicked(template: CampaignTemplate | null): void {
    this.editingCampaign = null;
    this.pendingTemplate = template;
    this.mode = 'edit';
  }

  openEdit(item: CampaignModel): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.editingCampaign = item;
    this.pendingTemplate = null;
    this.mode = 'edit';
  }

  onComposerClosed(saved: boolean): void {
    this.mode = 'board';
    if (saved) {
      this.load();
    }
  }
}
