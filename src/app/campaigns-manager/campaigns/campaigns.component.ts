import { Component, OnInit } from '@angular/core';
import { ACTIVE_CAMPAIGN_TYPES, CAMPAIGN_TYPE_LABELS, CampaignModel, effectiveStatus } from 'src/app/common/models/domain/campaign.model';
import { QueryParam, WhereFilterOperandKeys } from 'src/app/common/dao/firebase.dao';
import { CampaignTemplate } from 'src/app/common/models/domain/campaign-template.model';
import { CampaignService } from 'src/app/common/services/data/campaign.service';
import { ProductService } from 'src/app/common/services/data/product.service';
import { EventService } from 'src/app/common/services/data/event.service';
import { CouponService } from 'src/app/common/services/data/coupon.service';
import { ProductModel } from 'src/app/common/models/utils/product.model';
import { EventModel } from 'src/app/common/models/domain/event.model';
import { CouponModel } from 'src/app/common/models/utils/coupon.model';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { PagedCollectionSource } from '../../shared/paged-collection-source';
import { dateFromTimestamp, toMillis } from 'src/app/common/utils/date-from-timestamp';

// The Campaigns landing screen: "Live Now" hub cards (what's running and
// its headline numbers) above the house-style list of ALL campaigns - one
// screen answers both "how are we doing?" and "where's that campaign from
// June?". New Campaign goes through the Template Gallery, then the
// Composer; row/card opens the Composer directly - both in-page modes,
// same no-route treatment as Products' editor.
@Component({
    selector: 'app-campaigns',
    templateUrl: './campaigns.component.html',
    styleUrls: ['./campaigns.component.scss'],
    standalone: false
})
export class CampaignsComponent implements OnInit {
  mode: 'list' | 'gallery' | 'edit' = 'list';

  // ---- List state ----
  columns: DataGridColumn<CampaignModel>[] = [
    { key: 'name', label: 'Name' },
    { key: 'type', label: 'Type', value: (item) => this.typeLabels[item.type] },
    { key: 'status', label: 'Status', value: (item) => effectiveStatus(item).toUpperCase() },
    { key: 'startDate', label: 'Start', type: 'date', value: (item) => dateFromTimestamp(item.startDate) },
    { key: 'endDate', label: 'End', type: 'date', value: (item) => dateFromTimestamp(item.endDate) },
    { key: 'target', label: 'Target', value: (item) => this.targetName(item) },
    { key: 'results', label: 'Results', value: (item) => this.resultsSummary(item) }
  ];

  itemType = 'Campaign';

  private readonly screenKey = 'campaigns-manager.campaigns';

  headerActions: ListHeaderAction[] = [];

  rowActions: DataGridRowAction<CampaignModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item), visible: () => this.permissionService.canDelete(this.screenKey) }];

  paged: PagedCollectionSource<CampaignModel>;

  liveCampaigns: CampaignModel[] = [];

  // One-time reference loads for target-name resolution on rows/cards -
  // same reasoning as products.component.ts's reference data.
  private products: ProductModel[] = [];
  private events: EventModel[] = [];
  private coupons: CouponModel[] = [];

  typeLabels = CAMPAIGN_TYPE_LABELS;
  effectiveStatus = effectiveStatus;

  // ---- Composer hand-off ----
  editingCampaign: CampaignModel | null = null;
  pendingTemplate: CampaignTemplate | null = null;

  constructor(
    private service: CampaignService,
    private productService: ProductService,
    private eventService: EventService,
    private couponService: CouponService,
    private permissionService: PermissionService,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {
    // Working campaigns only - the imported 'email' history (477 docs) has
    // its own Sent Emails screen and must not drown this list. Composite
    // index (type, name) backs the filter+orderBy pair.
    this.paged = new PagedCollectionSource<CampaignModel>(
      (pageSize, cursor) => this.service.getPage(pageSize, cursor, 'name', 'asc',
        [new QueryParam('type', WhereFilterOperandKeys.in, ACTIVE_CAMPAIGN_TYPES)]),
      50
    );
  }

  ngOnInit(): void {
    this.productService.getAll().then((products) => {
      this.products = products;
    });
    this.eventService.getAll().then((events) => {
      this.events = events;
    });
    this.couponService.getAll().then((coupons) => {
      this.coupons = coupons;
    });

    this.paged.loadFirstPage();
    this.loadHub();

    this.headerActions = [
      ...(this.permissionService.canAdd(this.screenKey) ? [{ label: 'New Campaign', icon: 'add', onClick: () => this.showGallery() }] : [])
    ];
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

  // ---- Row/card display helpers ----

  targetName(item: CampaignModel): string {
    if (item.type === 'product') {
      return this.products.find((p) => p.id === item.productId)?.title ?? '';
    }
    if (item.type === 'event') {
      return this.events.find((e) => e.id === item.eventId)?.eventName ?? '';
    }
    const code = this.coupons.find((c) => c.id === item.couponId)?.code;
    return [code, item.placement].filter(Boolean).join(' · ');
  }

  resultsSummary(item: CampaignModel): string {
    const status = effectiveStatus(item);
    if (status === 'draft' || status === 'scheduled') {
      return '';
    }
    if (item.type === 'product') {
      return `${item.stats.redemptions} redemptions`;
    }
    if (item.type === 'event') {
      return `${item.stats.registrations} registrations`;
    }
    return `${item.stats.leads} leads · ${item.stats.redemptions} used`;
  }

  // The 3 stat tiles on a hub card, by what matters for the type.
  hubStats(item: CampaignModel): { value: string; label: string }[] {
    const currency = (n: number) => '$' + Math.round(n).toLocaleString();
    if (item.type === 'product') {
      return [
        { value: String(item.stats.emailsSent), label: 'Emails Sent' },
        { value: String(item.stats.redemptions), label: 'Redeemed' },
        { value: currency(item.stats.revenue), label: 'Revenue' }
      ];
    }
    if (item.type === 'event') {
      const days = this.daysLeft(item);
      return [
        { value: String(item.stats.registrations), label: 'Registrations' },
        { value: String(item.stats.linkClicks), label: 'Link Clicks' },
        { value: days === null ? '—' : `${days}d`, label: 'Left' }
      ];
    }
    return [
      { value: String(item.stats.leads), label: 'Leads' },
      { value: String(item.stats.redemptions), label: 'Redeemed' },
      { value: currency(item.stats.revenue), label: 'Revenue' }
    ];
  }

  private daysLeft(item: CampaignModel): number | null {
    const end = toMillis(item.endDate);
    if (!end) {
      return null;
    }
    return Math.max(0, Math.ceil((end - Date.now()) / 86400000));
  }

  delete(item: CampaignModel): void {
    if (!this.permissionService.canDelete(this.screenKey)) {
      return;
    }
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
          this.reload();
        });
      }
    });
  }

  // ---- Gallery / Composer hand-off ----

  showGallery(): void {
    if (!this.permissionService.canAdd(this.screenKey)) {
      return;
    }
    this.mode = 'gallery';
  }

  onTemplatePicked(template: CampaignTemplate | null): void {
    this.editingCampaign = null;
    this.pendingTemplate = template;
    this.mode = 'edit';
  }

  showEdit(item: CampaignModel): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.editingCampaign = item;
    this.pendingTemplate = null;
    this.mode = 'edit';
  }

  onComposerClosed(saved: boolean): void {
    this.mode = 'list';
    if (saved) {
      this.reload();
    }
  }

  private reload(): void {
    this.paged.loadFirstPage();
    this.loadHub();
  }
}
