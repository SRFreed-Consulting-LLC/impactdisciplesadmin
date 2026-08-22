import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { CampaignModel, campaignKindLabel, channelLabel, effectiveStatus } from 'src/app/common/models/domain/campaign.model';
import { CampaignService } from 'src/app/common/services/data/campaign.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { PagedCollectionSource } from '../../shared/paged-collection-source';
import { dateFromTimestamp, toMillis } from '@impact-common/shared/utils/date-from-timestamp';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { describeCampaignDelete, describeCampaignDeleteResult } from './campaign-delete-text';

// The Campaigns landing screen (Campaign Manager v2): "Live Now" hub cards
// above the paged list of EVERY campaign - including the regrouped
// Mailchimp history, which is just campaigns that already ran. A row opens
// the campaign DETAIL view (the v2 centerpiece - funnel + touches
// timeline), in-page like Products' editor, deep-linkable via
// ?campaignId=. New Campaign / Edit Campaign open the wizard (Phase 2);
// emails are authored on the detail view's touch editor.
//
// Also HOSTS the Sent Emails log (2026-08-21) - the read-only history of
// every email across every campaign, opened from a button in this grid's
// own header rather than the nav leaf it used to be. Clicking one of its
// rows lands on that email's campaign here, which is why this screen owns
// it rather than the manager shell.
@Component({
    selector: 'app-campaigns',
    templateUrl: './campaigns.component.html',
    styleUrls: ['./campaigns.component.scss'],
    standalone: false
})
export class CampaignsComponent implements OnInit, OnDestroy {
  mode: 'list' | 'detail' | 'wizard' | 'sentEmails' = 'list';

  /** The campaign the wizard edits; null = creating a new one. */
  wizardCampaign: CampaignModel | null = null;
  /** Where the wizard returns to on cancel. */
  private wizardReturnMode: 'list' | 'detail' = 'list';

  columns: DataGridColumn<CampaignModel>[] = [
    { key: 'name', label: 'Name' },
    { key: 'kind', label: 'Kind', value: (item) => campaignKindLabel(item) },
    { key: 'channels', label: 'Channels', value: (item) => (item.channels ?? []).map(channelLabel).join(' + ') },
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

  /** Raw "live now" result, before pinned campaigns are subtracted. */
  private liveAll: CampaignModel[] = [];

  selectedCampaign: CampaignModel | null = null;

  kindLabel = campaignKindLabel;
  channelLabel = channelLabel;
  effectiveStatus = effectiveStatus;

  private ngUnsubscribe = new Subject<void>();

  constructor(
    private service: CampaignService,
    private permissionService: PermissionService,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService,
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
    this.loadPinned();

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
      this.liveAll = [...live, ...scheduled]
        .filter((c) => effectiveStatus(c) === 'live')
        .sort((a, b) => toMillis(a.endDate) - toMillis(b.endDate));
      this.applyHubFilter();
    });
  }

  // A pinned campaign is already on screen in the strip above; a Live Now
  // card for it would just duplicate it - and the six repaired long-running
  // series (see scripts/fix-open-ended-campaign-status.js) are exactly the
  // ones staff pin. Recomputed whenever EITHER query resolves, since they
  // run concurrently and either can land first.
  private applyHubFilter(): void {
    const pinnedIds = new Set(this.pinnedCampaigns.map((c) => c.id));
    this.liveCampaigns = this.liveAll.filter((c) => !pinnedIds.has(c.id));
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

  get canDelete(): boolean {
    return this.permissionService.canDelete(this.screenKey);
  }

  get canPin(): boolean {
    return this.permissionService.canEdit(this.screenKey);
  }

  rowActions: DataGridRowAction<CampaignModel>[] = [
    {
      icon: 'push_pin',
      tooltip: 'PIN TO TOP',
      onClick: (item) => this.togglePin(item),
      visible: (item) => this.canPin && !item.pinned,
    },
    {
      icon: 'push_pin',
      tooltip: 'UNPIN',
      onClick: (item) => this.togglePin(item),
      visible: (item) => this.canPin && !!item.pinned,
    },
    { icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.deleteCampaign(item), visible: () => this.canDelete }
  ];

  // ---- Pinned ----
  // A handful of ongoing series (Monthly Newsletter, Prayer Letter) that
  // staff open constantly and which otherwise sink down a list ordered by
  // startDate.
  //
  // Fetched as their own small query and rendered ABOVE the list rather than
  // being sorted to the top of it - the list is a Firestore cursor-paged
  // query, so a client-side sort would only float a pinned campaign to the
  // top of the page it happens to be on, and adding `pinned` to the query's
  // orderBy would drop every campaign that lacks the field (Firestore orders
  // only documents that HAVE it). Same shape as the Live Now hub above.
  pinnedCampaigns: CampaignModel[] = [];

  private loadPinned(): void {
    this.service.getAllByValue('pinned', true).then((pinned) => {
      this.pinnedCampaigns = pinned.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
      this.applyHubFilter();
    });
  }

  async togglePin(item: CampaignModel): Promise<void> {
    if (!this.canPin) {
      return;
    }
    const next = !item.pinned;
    try {
      await this.service.update(item.id!, { ...item, pinned: next });
      // Keep the row the grid is already rendering in step, so the action
      // icon flips without waiting for the list to reload.
      item.pinned = next;
      this.loadPinned();
      this.snackbar.success(next ? `${item.name} pinned to top` : `${item.name} unpinned`);
    } catch (err) {
      this.snackbar.error('Could not update pin: ' + ((err as Error)?.message ?? err));
    }
  }

  // Cascade delete (campaign + its emails + its popup) behind a confirm
  // that spells out what goes - see CampaignService.deleteCascade() for
  // what is deliberately NOT removed. Refused while emails are in flight.
  async deleteCampaign(item: CampaignModel): Promise<void> {
    if (!this.canDelete) {
      return;
    }
    try {
      const plan = await this.service.planDelete(item.id!);
      if (plan.inFlight.length > 0) {
        this.snackbar.error(`Cannot delete while emails are sending or scheduled: ${plan.inFlight.join(', ')}`);
        return;
      }
      const confirmed = await this.confirmService.confirm(describeCampaignDelete(item, plan), 'Delete Campaign');
      if (!confirmed) {
        return;
      }
      const result = await this.service.deleteCascade(item.id!);
      this.snackbar.success(describeCampaignDeleteResult(result));
      if (this.selectedCampaign?.id === item.id) {
        this.onDetailClosed();
      }
      this.paged.loadFirstPage();
      this.loadHub();
    } catch (err) {
      this.snackbar.error('Delete failed: ' + ((err as Error)?.message ?? err));
    }
  }

  onDetailDeleted(): void {
    this.onDetailClosed();
    this.paged.loadFirstPage();
    this.loadHub();
    this.loadPinned();
  }

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

  // ---- Sent Emails (the in-page email history) ----
  // Read-only, so it rides this screen's VIEW grant - no add/edit check.
  openSentEmails(): void {
    this.mode = 'sentEmails';
  }

  onSentEmailsClosed(): void {
    this.mode = 'list';
  }

  // A row click in the log means "take me to this email's campaign".
  // Fetched by id rather than looked up in the paged list - the campaign
  // may sit many pages down, or not be loaded at all, the same reason the
  // ?campaignId= deep link fetches instead of scanning. A campaign that no
  // longer exists returns to the list rather than blanking the screen.
  openCampaignFromSentEmails(campaignId: string): void {
    this.service.getById(campaignId).then((campaign) => {
      if (campaign) {
        this.openDetail(campaign);
      } else {
        this.snackbar.error('That campaign no longer exists.');
        this.mode = 'list';
      }
    });
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
