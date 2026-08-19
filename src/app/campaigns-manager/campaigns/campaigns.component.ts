import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { CampaignModel, campaignKindLabel, effectiveStatus } from 'src/app/common/models/domain/campaign.model';
import { CampaignService } from 'src/app/common/services/data/campaign.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { DataGridColumn } from '../../shared/data-grid/data-grid.model';
import { PagedCollectionSource } from '../../shared/paged-collection-source';
import { dateFromTimestamp, toMillis } from 'src/app/common/utils/date-from-timestamp';

// The Campaigns landing screen (Campaign Manager v2): "Live Now" hub cards
// above the paged list of EVERY campaign - including the regrouped
// Mailchimp history, which is just campaigns that already ran. A row opens
// the campaign DETAIL view (the v2 centerpiece - funnel + touches
// timeline), in-page like Products' editor, deep-linkable via
// ?campaignId=. New Campaign / Edit Campaign open the wizard (Phase 2);
// emails are authored on the detail view's touch editor.
@Component({
    selector: 'app-campaigns',
    templateUrl: './campaigns.component.html',
    styleUrls: ['./campaigns.component.scss'],
    standalone: false
})
export class CampaignsComponent implements OnInit, OnDestroy {
  mode: 'list' | 'detail' | 'wizard' = 'list';

  /** The campaign the wizard edits; null = creating a new one. */
  wizardCampaign: CampaignModel | null = null;
  /** Where the wizard returns to on cancel. */
  private wizardReturnMode: 'list' | 'detail' = 'list';

  columns: DataGridColumn<CampaignModel>[] = [
    { key: 'name', label: 'Name' },
    { key: 'kind', label: 'Kind', value: (item) => campaignKindLabel(item) },
    { key: 'channels', label: 'Channels', value: (item) => (item.channels ?? []).join(' + ') },
    { key: 'status', label: 'Status', value: (item) => effectiveStatus(item).toUpperCase() },
    { key: 'startDate', label: 'Start', type: 'date', value: (item) => dateFromTimestamp(item.startDate) },
    { key: 'endDate', label: 'End', type: 'date', value: (item) => dateFromTimestamp(item.endDate) },
    { key: 'sent', label: 'Sent', type: 'number', value: (item) => item.stats.sent },
    { key: 'uniqueOpens', label: 'Opens', type: 'number', value: (item) => item.stats.uniqueOpens },
    { key: 'openRate', label: 'Open %', type: 'number', value: (item) => this.openRate(item) },
    { key: 'clicks', label: 'Clicks', type: 'number', value: (item) => item.stats.clicks },
    { key: 'purchases', label: 'Purchases', type: 'number', visible: false, value: (item) => item.stats.purchases },
    { key: 'revenue', label: 'Revenue', type: 'currency', visible: false, value: (item) => item.stats.revenue }
  ];

  itemType = 'Campaign';

  private readonly screenKey = 'campaigns-manager.campaigns';

  paged: PagedCollectionSource<CampaignModel>;

  liveCampaigns: CampaignModel[] = [];

  selectedCampaign: CampaignModel | null = null;

  kindLabel = campaignKindLabel;
  effectiveStatus = effectiveStatus;

  private ngUnsubscribe = new Subject<void>();

  constructor(
    private service: CampaignService,
    private permissionService: PermissionService,
    private route: ActivatedRoute,
    private router: Router
  ) {
    // Newest efforts first - regrouped history and future campaigns share
    // one timeline. Plain orderBy, no filter, no composite index needed.
    this.paged = new PagedCollectionSource<CampaignModel>(
      (pageSize, cursor) => this.service.getPage(pageSize, cursor, 'startDate', 'desc'),
      50
    );
  }

  ngOnInit(): void {
    this.paged.loadFirstPage();
    this.loadHub();

    // ?campaignId= deep link (Status Board cards route here with it; same
    // pattern as Purchases' purchaseId deep link).
    this.route.queryParamMap.pipe(takeUntil(this.ngUnsubscribe)).subscribe((params) => {
      const campaignId = params.get('campaignId');
      if (campaignId && campaignId !== this.selectedCampaign?.id) {
        this.service.getById(campaignId).then((campaign) => {
          if (campaign) {
            this.selectedCampaign = campaign;
            this.mode = 'detail';
          }
        });
      }
    });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  // "Live now" = effectively live, which includes scheduled campaigns whose
  // start date has arrived without anyone flipping the field - so query
  // both stored statuses and let effectiveStatus() decide.
  private loadHub(): void {
    Promise.all([
      this.service.getAllByValue('status', 'live'),
      this.service.getAllByValue('status', 'scheduled')
    ]).then(([live, scheduled]) => {
      this.liveCampaigns = [...live, ...scheduled]
        .filter((c) => effectiveStatus(c) === 'live')
        .sort((a, b) => toMillis(a.endDate) - toMillis(b.endDate));
    });
  }

  private openRate(item: CampaignModel): number {
    return item.stats.sent > 0 ? Math.round((item.stats.uniqueOpens / item.stats.sent) * 100) : 0;
  }

  hubStats(item: CampaignModel): { value: string; label: string }[] {
    return [
      { value: String(item.stats.sent), label: 'Sent' },
      { value: String(item.stats.uniqueOpens), label: 'Opens' },
      { value: String(item.stats.clicks), label: 'Clicks' }
    ];
  }

  get canAdd(): boolean {
    return this.permissionService.canAdd(this.screenKey);
  }

  headerActions = [
    { label: 'New Campaign', icon: 'add', onClick: () => this.newCampaign() }
  ];

  openDetail(item: CampaignModel): void {
    if (!this.permissionService.canView(this.screenKey)) {
      return;
    }
    this.selectedCampaign = item;
    this.mode = 'detail';
    this.router.navigate([], { queryParams: { campaignId: item.id }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  onDetailClosed(): void {
    this.mode = 'list';
    this.selectedCampaign = null;
    this.router.navigate([], { queryParams: { campaignId: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  newCampaign(): void {
    if (!this.canAdd) {
      return;
    }
    this.wizardCampaign = null;
    this.wizardReturnMode = 'list';
    this.mode = 'wizard';
  }

  editCampaign(campaign: CampaignModel): void {
    this.wizardCampaign = campaign;
    this.wizardReturnMode = 'detail';
    this.mode = 'wizard';
  }

  onWizardClosed(saved: CampaignModel | null): void {
    if (saved) {
      this.paged.loadFirstPage();
      this.openDetail(saved);
    } else {
      this.mode = this.wizardReturnMode === 'detail' && this.selectedCampaign ? 'detail' : 'list';
    }
    this.wizardCampaign = null;
  }
}
