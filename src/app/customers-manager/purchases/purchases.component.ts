import { Component, OnInit } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { FormBuilder, FormGroup } from '@angular/forms';
import { CheckoutForm } from 'src/app/common/models/utils/cart.model';
import { PurchasesService } from 'src/app/common/services/data/purchases.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { EnumHelper } from 'src/app/common/utils/enum_helper';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { NewRecordTracker } from '../../shared/new-record-tracking.util';
import { PagedCollectionSource } from '../../shared/paged-collection-source';

// Full-page in-place edit view (mode: 'list' | 'edit', no popup - see
// products.component.ts for the established precedent this mirrors) rather
// than the MatDialog this screen started with. Edit-only, matching the
// original: purchases are created by the storefront checkout, never by an
// admin here. The original's dead showAddModal() (seeded selectedItem from
// a ProductModel spread that didn't match CheckoutForm's shape, called by
// no button) is not ported.
@Component({
    selector: 'app-purchases',
    templateUrl: './purchases.component.html',
    styleUrls: ['./purchases.component.scss'],
    standalone: false
})
export class PurchasesComponent implements OnInit {
  mode: 'list' | 'edit' = 'list';

  // ---- List state ----
  // One-time paged fetches instead of a whole-collection streamAll() - see
  // products.component.ts/customers.component.ts for the established
  // pattern this mirrors. No admin-only summary row any more (it used to
  // sum this screen's full live rowset; once paginated that would only ever
  // be a sum of whatever's been scrolled into view, silently wrong as a
  // "total" - removed outright rather than ship a misleading number).
  paged: PagedCollectionSource<CheckoutForm>;

  itemType = 'Purchase';

  // Mirrors the original's column chooser - most columns visible by
  // default, the billing-address ones default hidden (never actually used
  // day-to-day, kept toggleable for parity). The billing-address and date
  // columns had no filter cell in the original (dxo-filter-row left them
  // blank), reproduced here via filterable:false.
  columns: DataGridColumn<CheckoutForm>[] = [
    { key: 'fulfillmentStatus', label: 'Status', value: (item) => this.service.getFulfillmentStatusLabel(item.fulfillmentStatus) },
    { key: 'dateProcessed', label: 'Date', type: 'date', dateFormat: 'short', filterable: false },
    { key: 'firstName', label: 'First Name' },
    { key: 'lastName', label: 'Last Name' },
    { key: 'email', label: 'Email' },
    { key: 'billingAddress1', label: 'Address 1', visible: false, filterable: false, value: (item) => item.billingAddress?.address1 },
    { key: 'billingAddress2', label: 'Address 2', visible: false, filterable: false, value: (item) => item.billingAddress?.address2 },
    { key: 'billingCity', label: 'City', visible: false, filterable: false, value: (item) => item.billingAddress?.city },
    { key: 'billingState', label: 'State', visible: false, filterable: false, value: (item) => item.billingAddress?.state },
    { key: 'billingZip', label: 'Zip', visible: false, filterable: false, value: (item) => item.billingAddress?.zip },
    { key: 'receipt', label: 'Receipt' },
    { key: 'couponCode', label: 'Coupon' },
    { key: 'totalBeforeDiscount', label: 'Total', type: 'currency', value: (item) => this.service.getProductTotalDisplayAmount(item) },
    { key: 'discount', label: 'Discount', type: 'currency', value: (item) => this.service.getDiscountDisplayAmount(item) },
    { key: 'estimatedTaxes', label: 'Taxes', type: 'currency', value: (item) => this.service.getTaxesDisplayAmount(item) },
    { key: 'shippingRate', label: 'Shipping', type: 'currency', value: (item) => this.service.getShippingDisplayAmount(item) },
    { key: 'charged', label: 'Charged', type: 'currency', value: (item) => this.service.getChargedDisplayAmount(item) },
    { key: 'refundAmount', label: 'Refunded', type: 'currency' }
  ];

  rowActions: DataGridRowAction<CheckoutForm>[] = [
    { icon: 'local_shipping', tooltip: 'DOWNLOAD SHIPPING LABEL', onClick: (item) => this.getShippingLabel(item), visible: (item) => this.permissionService.canEdit(this.screenKey) && this.isShippingButtonVisible(item) },
    { icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item), visible: () => this.permissionService.canDelete(this.screenKey) }
  ];

  private readonly screenKey = 'customers-manager.purchases';

  // See new-record-tracking.util.ts - marks newly-arrived purchases seen the
  // moment this screen loads, and keeps them highlighted for this page view.
  tracker: NewRecordTracker<CheckoutForm>;
  rowClass = (row: CheckoutForm): string => (this.tracker.newIds.has(row.id!) ? 'row--new' : '');

  // ---- Edit state ----
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);

  states = EnumHelper.getStateTypesAsArray();
  phoneTypes = EnumHelper.getPhoneTypesAsArray();

  editingItem: CheckoutForm | null = null;

  constructor(
    // Public - the template calls its display-amount/label methods directly
    // (service.getChargedDisplayAmount(item), etc.) rather than through
    // component wrappers, same as app-purchase-details already does with
    // service.calculateProductCostAmount().
    public service: PurchasesService,
    private permissionService: PermissionService,
    private fb: FormBuilder,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {
    this.tracker = new NewRecordTracker(this.service);
    this.paged = new PagedCollectionSource<CheckoutForm>(
      (pageSize, cursor) => this.service.getPage(pageSize, cursor, 'dateProcessed', 'desc'),
      50
    );
  }

  ngOnInit(): void {
    // Each page already comes back ordered by dateProcessed desc from
    // Firestore, and pages are appended in fetch order - no client-side
    // re-sort needed (matches products.component.ts/customers.component.ts).
    this.paged.loadFirstPage();

    // NewRecordTracker.capture() only ever needs whatever's currently
    // loaded (it marks-seen once, on first call, and no-ops after) - with
    // streamAll() that first emission used to be the whole collection, now
    // it's just page 1. A "new" purchase is inherently recent, so page 1 in
    // dateProcessed-desc order should always include it in practice, but
    // this is a real behavior change from "sees literally everything"
    // worth knowing about if a new-record badge is ever missed.
    this.paged.rows$.subscribe((items) => this.tracker.capture(items));
  }

  // getProductTotalDisplayAmount/getDiscountDisplayAmount/
  // getTaxesDisplayAmount/getShippingDisplayAmount/
  // getShippingDiscountDisplayAmount/getChargedDisplayAmount/
  // getOrderStatusDisplay/getFulfillmentStatusLabel all moved onto
  // PurchasesService (see its own comment) so the Sale Details tab's stat
  // tiles render the exact same figures as this screen's columns and
  // summary block - call `service.xxx()` directly instead of a component
  // wrapper.

  getOrderItemCount(item: CheckoutForm): number {
    return (item.cartItems ?? []).map((cartItem) => cartItem.orderQuantity ?? 0).reduce((a, b) => a + b, 0);
  }

  delete(item: CheckoutForm): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }

  isShippingButtonVisible(item: CheckoutForm): boolean {
    return (item.shippingRate ?? 0) > 0;
  }

  // Moved into PurchasesService (getShippingLabel/downloadShippingLabel) so
  // the Fulfillment screen can trigger the exact same real action - this is
  // now a thin delegate. Purchasing a shipping label costs real postage;
  // never triggered during my own live verification.
  getShippingLabel(item: CheckoutForm): Promise<void> {
    return this.service.getShippingLabel(item);
  }

  // ---- Edit view ----

  showEditModal(item: CheckoutForm): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.editingItem = item;

    this.form = this.fb.group({
      phone: this.fb.group({
        countryCode: [item.phone?.countryCode ?? ''],
        number: [item.phone?.number ?? ''],
        type: [item.phone?.type ?? null]
      }),
      shippingAddress: this.fb.group({
        address1: [item.shippingAddress?.address1 ?? ''],
        address2: [item.shippingAddress?.address2 ?? ''],
        city: [item.shippingAddress?.city ?? ''],
        state: [item.shippingAddress?.state ?? ''],
        zip: [item.shippingAddress?.zip ?? ''],
        country: [item.shippingAddress?.country ?? '']
      })
    });

    this.mode = 'edit';
  }

  onCancel(): void {
    this.inProgress$.next(false);
    this.mode = 'list';
  }

  onSave(): void {
    this.inProgress$.next(true);
    const value: CheckoutForm = { ...this.editingItem, ...this.form.value };

    this.service.update(value.id!, value).then((result) => {
      if (result) {
        this.snackbar.success('Purchase Updated');
        this.mode = 'list';
        this.inProgress$.next(false);
      } else {
        this.inProgress$.next(false);
        this.snackbar.error('Some Error Occured');
      }
    });
  }

}
