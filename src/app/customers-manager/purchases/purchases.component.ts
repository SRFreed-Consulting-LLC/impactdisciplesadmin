import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { FormBuilder, FormGroup } from '@angular/forms';
import { CheckoutForm } from 'src/app/common/models/utils/cart.model';
import { PurchasesService } from 'src/app/common/services/data/purchases.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { EnumHelper } from 'src/app/common/utils/enum_helper';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { NewRecordTracker } from '../../shared/new-record-tracking.util';

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
  purchases$: Observable<CheckoutForm[]>;

  itemType = 'Purchase';

  // Mirrors the original's column chooser - most columns visible by
  // default, the billing-address ones default hidden (never actually used
  // day-to-day, kept toggleable for parity). The billing-address and date
  // columns had no filter cell in the original (dxo-filter-row left them
  // blank), reproduced here via filterable:false.
  columns: DataGridColumn<CheckoutForm>[] = [
    { key: 'processedStatus', label: 'Status' },
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
    { key: 'totalBeforeDiscount', label: 'Total', type: 'currency', value: (item) => this.getProductTotalDisplayAmount(item) },
    { key: 'discount', label: 'Discount', type: 'currency', value: (item) => this.getDiscountDisplayAmount(item) },
    { key: 'estimatedTaxes', label: 'Taxes', type: 'currency', value: (item) => this.getTaxesDisplayAmount(item) },
    { key: 'shippingRate', label: 'Shipping', type: 'currency', value: (item) => this.getShippingDisplayAmount(item) },
    { key: 'charged', label: 'Charged', type: 'currency', value: (item) => this.getChargedDisplayAmount(item) },
    { key: 'refundAmount', label: 'Refunded', type: 'currency' }
  ];

  rowActions: DataGridRowAction<CheckoutForm>[] = [
    { icon: 'local_shipping', tooltip: 'DOWNLOAD SHIPPING LABEL', onClick: (item) => this.getShippingLabel(item), visible: (item) => this.permissionService.canEdit(this.screenKey) && this.isShippingButtonVisible(item) },
    { icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item), visible: () => this.permissionService.canDelete(this.screenKey) }
  ];

  private readonly screenKey = 'customers-manager.purchases';

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  // Backs the Admin-only summary row - kept in sync via (visibleRowsChange),
  // since the grid now owns filtering/sorting rather than this component.
  currentRows: CheckoutForm[] = [];

  // See new-record-tracking.util.ts - marks newly-arrived purchases seen the
  // moment this screen loads, and keeps them highlighted for this page view.
  tracker: NewRecordTracker<CheckoutForm>;
  rowClass = (row: CheckoutForm): string => (this.tracker.newIds.has(row.id!) ? 'row--new' : '');

  // ---- Edit state ----
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);

  states = EnumHelper.getStateTypesAsArray();
  phoneTypes = EnumHelper.getPhoneTypesAsArray();
  statuses = ['NEW', 'COMPLETE', 'REFUNDED'];

  editingItem: CheckoutForm | null = null;

  constructor(
    private service: PurchasesService,
    private permissionService: PermissionService,
    private fb: FormBuilder,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {
    this.tracker = new NewRecordTracker(this.service);
  }

  ngOnInit(): void {
    this.purchases$ = this.service.streamAll().pipe(
      tap((items) => this.tracker.capture(items)),
      tap(() => this.loading$.next(false))
    );
  }

  // Backs the Admin-only summary row - the grid now owns filtering/sorting,
  // so this just mirrors whatever it currently has on screen.
  onVisibleRowsChange(rows: CheckoutForm[]): void {
    this.currentRows = rows;
  }

  // Real dollar amounts come from the PayPal receipt when present, falling
  // back to the general order-total fields the storefront's checkout
  // writes on every purchase regardless of payment method. Shared by both
  // the list columns and the edit view's summary block (called there with
  // editingItem).
  getProductTotalDisplayAmount(item: CheckoutForm): number {
    return item.payPalReceipt ? parseFloat(item.payPalReceipt.purchase_units[0]?.amount?.breakdown?.item_total?.value ?? '') : (item.total ?? 0) > 0 ? item.total! : 0;
  }

  getDiscountDisplayAmount(item: CheckoutForm): number {
    const discount = item.payPalReceipt?.purchase_units[0]?.amount?.breakdown?.discount;
    return discount
      ? parseFloat(discount.value)
      : (item.discount ?? 0) > 0
        ? item.discount!
        : 0;
  }

  getTaxesDisplayAmount(item: CheckoutForm): number {
    return item.payPalReceipt ? parseFloat(item.payPalReceipt.purchase_units[0]?.amount?.breakdown?.tax_total?.value ?? '') : (item.estimatedTaxes ?? 0) > 0 ? item.estimatedTaxes! : 0;
  }

  getShippingDisplayAmount(item: CheckoutForm): number {
    return item.payPalReceipt ? parseFloat(item.payPalReceipt.purchase_units[0]?.amount?.breakdown?.shipping?.value ?? '') : item.shippingRate ? item.shippingRate : 0;
  }

  getShippingDiscountDisplayAmount(item: CheckoutForm): number {
    return item.payPalReceipt ? parseFloat(item.payPalReceipt.purchase_units[0]?.amount?.breakdown?.shipping_discount?.value ?? '') : (item.shippingDiscount ?? 0) > 0 ? item.shippingDiscount! : 0;
  }

  getChargedDisplayAmount(item: CheckoutForm): number {
    if (item.payPalReceipt) {
      return parseFloat(item.payPalReceipt.purchase_units[0]?.amount?.value ?? '');
    }

    // 2026-08-12 fullsweep fix: this used to be a single ternary that
    // computed (total - discount) only to test its sign, then returned the
    // un-discounted item.total! regardless - every non-PayPal order's
    // "Charged" figure (list column + Admin summary row via sumOf('charged'))
    // was overstated by exactly the discount amount.
    const charged = (item.total ?? 0) - (item.discount ?? 0);
    return charged > 0 ? charged : 0;
  }

  // Falls back to processedStatus (NEW/COMPLETE/REFUNDED) for non-PayPal
  // orders - was a Stripe paymentIntent.status fallback before Stripe
  // support was removed from this app (Stripe is still used by the
  // storefront's own /give donation flow and by this repo's Cloud
  // Functions, just not read/displayed here anymore).
  getOrderStatusDisplay(item: CheckoutForm): string {
    return item.payPalReceipt ? item.payPalReceipt.status : item.processedStatus;
  }

  getOrderItemCount(item: CheckoutForm): number {
    return (item.cartItems ?? []).map((cartItem) => cartItem.orderQuantity ?? 0).reduce((a, b) => a + b, 0);
  }

  // Backs the Admin-only summary row - matches the original's dxo-summary
  // sums, computed over whatever's currently on screen (post-filter).
  sumOf(field: 'totalBeforeDiscount' | 'discount' | 'estimatedTaxes' | 'shippingRate' | 'charged' | 'refundAmount'): number {
    const amount = (item: CheckoutForm): number => {
      switch (field) {
        case 'totalBeforeDiscount': return this.getProductTotalDisplayAmount(item);
        case 'discount': return this.getDiscountDisplayAmount(item);
        case 'estimatedTaxes': return this.getTaxesDisplayAmount(item);
        case 'shippingRate': return this.getShippingDisplayAmount(item);
        case 'charged': return this.getChargedDisplayAmount(item);
        case 'refundAmount': return item.refundAmount ?? 0;
      }
    };
    return this.currentRows.reduce((sum, item) => sum + amount(item), 0);
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

  // Backs the summary row's *ngIf - was Admin-only before this system
  // existed (same as the download-shipping-label row action above), now
  // maps to edit permission on this screen.
  canEdit(): boolean {
    return this.permissionService.canEdit(this.screenKey);
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
      processedStatus: [item.processedStatus ?? 'NEW'],
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
