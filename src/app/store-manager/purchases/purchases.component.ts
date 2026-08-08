import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { FormBuilder, FormGroup } from '@angular/forms';
import { PaymentIntent } from '@stripe/stripe-js';
import { CheckoutForm } from 'impactdisciplescommon/src/models/utils/cart.model';
import { PurchasesService } from 'impactdisciplescommon/src/services/data/purchases.service';
import { AdminAuthService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';
import { EnumHelper } from 'impactdisciplescommon/src/utils/enum_helper';
import { environment } from 'src/environments/environment';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ColumnFilterValue, matchesColumnFilter, NUMBER_FILTER_OPERATORS, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';
import { ExcelColumn, exportToExcel } from '../../shared/table-export.util';

interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
}

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
  textOperators = TEXT_FILTER_OPERATORS;
  numberOperators = NUMBER_FILTER_OPERATORS;

  itemType = 'Purchase';

  // Mirrors the original's column chooser - most columns visible by
  // default, the billing-address ones default hidden (never actually used
  // day-to-day, kept toggleable for parity).
  columns: ColumnDef[] = [
    { key: 'processedStatus', label: 'Status', visible: true },
    { key: 'dateProcessed', label: 'Date', visible: true },
    { key: 'firstName', label: 'First Name', visible: true },
    { key: 'lastName', label: 'Last Name', visible: true },
    { key: 'email', label: 'Email', visible: true },
    { key: 'billingAddress1', label: 'Address 1', visible: false },
    { key: 'billingAddress2', label: 'Address 2', visible: false },
    { key: 'billingCity', label: 'City', visible: false },
    { key: 'billingState', label: 'State', visible: false },
    { key: 'billingZip', label: 'Zip', visible: false },
    { key: 'receipt', label: 'Receipt', visible: true },
    { key: 'couponCode', label: 'Coupon', visible: true },
    { key: 'totalBeforeDiscount', label: 'Total', visible: true },
    { key: 'discount', label: 'Discount', visible: true },
    { key: 'estimatedTaxes', label: 'Taxes', visible: true },
    { key: 'shippingRate', label: 'Shipping', visible: true },
    { key: 'charged', label: 'Charged', visible: true },
    { key: 'refundAmount', label: 'Refunded', visible: true }
  ];

  // Was read fresh via authService.getLoggedInUser().role on every
  // isVisible() call - see events.component.ts for the full explanation.
  currentUserRole?: string;

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  currentRows: CheckoutForm[] = [];

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});

  // ---- Edit state ----
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isRefunding$ = new BehaviorSubject<boolean>(false);

  states = EnumHelper.getStateTypesAsArray();
  phoneTypes = EnumHelper.getPhoneTypesAsArray();
  statuses = ['NEW', 'COMPLETE', 'REFUNDED'];

  editingItem: CheckoutForm | null = null;

  constructor(
    private service: PurchasesService,
    private authService: AdminAuthService,
    private fb: FormBuilder,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.authService.dao.loggedInUser$.subscribe((user) => {
      this.currentUserRole = user?.role;
    });

    this.purchases$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) => {
        const filtered = items
          .filter((item) => Object.keys(filters).every((field) => matchesColumnFilter(this.fieldValue(item, field), filters[field], this.fieldType(field))))
          .sort((a, b) => this.toMillis(b.dateProcessed) - this.toMillis(a.dateProcessed));
        this.currentRows = filtered;
        return filtered;
      }),
      tap(() => this.loading$.next(false))
    );
  }

  get displayedColumns(): string[] {
    return [...this.columns.filter((c) => c.visible).map((c) => c.key), 'actions'];
  }

  get filterColumns(): string[] {
    return [...this.columns.filter((c) => c.visible).map((c) => `${c.key}-filter`), 'actions-filter'];
  }

  isVisible(roles: string[]): boolean {
    return roles.some((role) => role === this.currentUserRole);
  }

  toggleColumn(column: ColumnDef): void {
    column.visible = !column.visible;
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
  }

  private fieldType(field: string): 'text' | 'number' | 'date' {
    if (field === 'dateProcessed') return 'date';
    if (['totalBeforeDiscount', 'discount', 'estimatedTaxes', 'shippingRate', 'charged', 'refundAmount'].includes(field)) return 'number';
    return 'text';
  }

  private fieldValue(item: CheckoutForm, field: string): any {
    switch (field) {
      case 'billingAddress1': return item.billingAddress?.address1;
      case 'billingAddress2': return item.billingAddress?.address2;
      case 'billingCity': return item.billingAddress?.city;
      case 'billingState': return item.billingAddress?.state;
      case 'billingZip': return item.billingAddress?.zip;
      case 'totalBeforeDiscount': return this.getProductTotalDisplayAmount(item);
      case 'charged': return this.getChargedDisplayAmount(item);
      default: return (item as any)[field];
    }
  }

  private toMillis(value: any): number {
    if (!value) return 0;
    return value instanceof Date ? value.getTime() : 0;
  }

  // Real dollar amounts come from the PayPal receipt when present, falling
  // back to the Stripe-derived fields the storefront itself already wrote.
  // Shared by both the list columns and the edit view's summary block
  // (called there with editingItem).
  getProductTotalDisplayAmount(item: CheckoutForm): number {
    return item.payPalReceipt ? parseFloat((item.payPalReceipt as any)?.purchase_units[0]?.amount?.breakdown.item_total.value) : (item.total ?? 0) > 0 ? item.total! : 0;
  }

  getDiscountDisplayAmount(item: CheckoutForm): number {
    return item.payPalReceipt && (item.payPalReceipt as any)?.purchase_units[0]?.amount?.breakdown?.discount
      ? parseFloat((item.payPalReceipt as any).purchase_units[0].amount.breakdown.discount.value)
      : (item.discount ?? 0) > 0
        ? item.discount!
        : 0;
  }

  getTaxesDisplayAmount(item: CheckoutForm): number {
    return item.payPalReceipt ? parseFloat((item.payPalReceipt as any).purchase_units[0].amount.breakdown.tax_total.value) : (item.estimatedTaxes ?? 0) > 0 ? item.estimatedTaxes! : 0;
  }

  getShippingDisplayAmount(item: CheckoutForm): number {
    return item.payPalReceipt ? parseFloat((item.payPalReceipt as any).purchase_units[0].amount.breakdown.shipping.value) : item.shippingRate ? item.shippingRate : 0;
  }

  getShippingDiscountDisplayAmount(item: CheckoutForm): number {
    return item.payPalReceipt ? parseFloat((item.payPalReceipt as any).purchase_units[0].amount.breakdown.shipping_discount.value) : (item.shippingDiscount ?? 0) > 0 ? item.shippingDiscount! : 0;
  }

  getChargedDisplayAmount(item: CheckoutForm): number {
    return item.payPalReceipt ? parseFloat((item.payPalReceipt as any)?.purchase_units[0]?.amount?.value) : (item.total ?? 0) - (item.discount ?? 0) > 0 ? item.total! : 0;
  }

  getOrderStatusDisplay(item: CheckoutForm): string {
    return item.payPalReceipt ? (item.payPalReceipt as any)?.status : (item.paymentIntent as PaymentIntent)?.status;
  }

  getOrderItemCount(item: CheckoutForm): number {
    return (item.cartItems ?? []).map((cartItem) => cartItem.orderQuantity ?? 0).reduce((a, b) => a + b, 0);
  }

  // Yellow-row highlight when what the customer was actually charged
  // (Stripe's own paymentIntent.amount, in cents) doesn't match this
  // record's own computed total - same check as the original's
  // onRowPrepared, now a bound row class instead of direct style mutation.
  isAmountMismatch(item: CheckoutForm): boolean {
    // totalBeforeDiscount is a real, server-written field (set at checkout)
    // that was never added to the CheckoutForm interface - read dynamically
    // here rather than declaring it, per the "don't change the data model"
    // constraint.
    let total = (item as any).totalBeforeDiscount ?? 0;
    if (item.discount) total -= item.discount;
    if (item.estimatedTaxes) total += item.estimatedTaxes;
    if (item.shippingRate) total += item.shippingRate;
    if (item.shippingDiscount) total -= item.shippingDiscount;

    const chargedCents = (item.paymentIntent as PaymentIntent)?.amount;
    return !!chargedCents && parseFloat(total.toFixed(2)) !== parseFloat((chargedCents / 100).toFixed(2));
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

  // Purchasing a shipping label costs real postage - this endpoint requires
  // a verified staff Firebase ID token. Never triggered during my own live
  // verification.
  async getShippingLabel(item: CheckoutForm): Promise<void> {
    if (!item.shippingLabel) {
      const idToken = await this.authService.dao.auth.currentUser?.getIdToken();

      const request = await fetch(environment.shippingLabelUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
        body: JSON.stringify({ shipId: item.shippingRateId.rateId })
      });

      const response = await request.json();

      if (response.code === 400) {
        this.snackbar.error(response.error.message);
        item.shippingLabel = response;
      } else {
        item.shippingLabel = response;
        this.service.update(item.id!, item).then((saved) => {
          this.downloadShippingLabel(saved!.shippingLabel.labelDownload.pdf);
        });
      }
    } else if (item.shippingLabel?.code) {
      this.snackbar.error(item.shippingLabel.error.message);
    } else {
      this.downloadShippingLabel(item.shippingLabel.labelDownload.pdf);
    }
  }

  private downloadShippingLabel(pdf: string): void {
    const link = document.createElement('a');
    link.setAttribute('target', '_blank');
    link.setAttribute('href', pdf);
    link.setAttribute('download', 'shipping-label.pdf');
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  // Exports whatever's currently on screen (after filters) - matches the
  // original's exportGridToExcel default (visible rows, current column set).
  exportExcel(): void {
    const visible = this.columns.filter((c) => c.visible);
    const columns: ExcelColumn<CheckoutForm>[] = visible.map((c) => ({
      header: c.label,
      value: (item) => this.fieldValue(item, c.key) ?? ''
    }));
    exportToExcel(this.currentRows, columns, 'purchases.xlsx');
  }

  // ---- Edit view ----

  showEditModal(item: CheckoutForm): void {
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

  // Refunds move real money - this endpoint requires a verified staff
  // Firebase ID token. The button that called this is commented out in the
  // original UI (method still exists, just unreachable) - preserved
  // exactly as-is here too: ported, but left unwired to any button, rather
  // than either removing it or re-enabling it. Never triggered during my
  // own live verification for that reason.
  refundOrder(): void {
    const item = this.editingItem!;
    const amountToRefund = item.total ?? 0;

    this.confirmService.confirm(`<i>Are you sure you want to refund amount $${amountToRefund.toFixed(2)}?</i>`, 'Confirm').then(async (confirmed) => {
      if (!confirmed) {
        return;
      }

      this.isRefunding$.next(true);

      const request = { paymentIntent: (item.paymentIntent as PaymentIntent).id };
      const idToken = await this.authService.dao.auth.currentUser?.getIdToken();

      const response = await fetch(environment.stripeRefundURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
        body: JSON.stringify(request)
      });

      const result = await response.json();

      item.refundAmount = Number(amountToRefund.toFixed(2));
      item.refundId = result.id;
      item.processedStatus = 'REFUNDED';

      this.service.update(item.id!, item).then(() => {
        this.snackbar.success(`Order Refunded ($${amountToRefund.toFixed(2)})`);
        this.isRefunding$.next(false);
      });
    });
  }
}
