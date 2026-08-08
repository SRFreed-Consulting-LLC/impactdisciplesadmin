import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { PaymentIntent } from '@stripe/stripe-js';
import { CheckoutForm } from 'impactdisciplescommon/src/models/utils/cart.model';
import { PurchasesService } from 'impactdisciplescommon/src/services/data/purchases.service';
import { AdminAuthService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';
import { environment } from 'src/environments/environment';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ColumnFilterValue, matchesColumnFilter, NUMBER_FILTER_OPERATORS, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';
import { ExcelColumn, exportToExcel } from '../../shared/table-export.util';
import { PurchaseDialogComponent } from './purchase-dialog.component';

interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
}

@Component({
    selector: 'app-purchases',
    templateUrl: './purchases.component.html',
    styleUrls: ['./purchases.component.scss'],
    standalone: false
})
export class PurchasesComponent implements OnInit {
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

  constructor(
    private service: PurchasesService,
    private authService: AdminAuthService,
    private dialog: MatDialog,
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
  // back to the Stripe-derived fields the storefront itself already wrote -
  // see purchase-dialog.component.ts for the identical per-record logic
  // (kept duplicated rather than shared, since it's this cheap and each
  // call site already needs its own CheckoutForm instance).
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

  getChargedDisplayAmount(item: CheckoutForm): number {
    return item.payPalReceipt ? parseFloat((item.payPalReceipt as any)?.purchase_units[0]?.amount?.value) : (item.total ?? 0) - (item.discount ?? 0) > 0 ? item.total! : 0;
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

  showEditModal(item: CheckoutForm): void {
    this.dialog.open(PurchaseDialogComponent, { width: '1000px', maxWidth: '95vw', data: { item } });
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
}
