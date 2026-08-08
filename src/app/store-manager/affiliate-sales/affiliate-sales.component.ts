import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { SelectionModel } from '@angular/cdk/collections';
import { Timestamp } from 'firebase/firestore';
import { AffilliatePaymentModel } from 'impactdisciplescommon/src/models/utils/affilliate-payment.model';
import { AffilliateSaleModel } from 'impactdisciplescommon/src/models/utils/affilliate-sale.model';
import { AffilliatePaymentsService } from 'impactdisciplescommon/src/services/data/affiliate-payment.service';
import { AffilliateSalesService } from 'impactdisciplescommon/src/services/data/affiliate-sales.service';
import { dateFromTimestamp } from 'impactdisciplescommon/src/utils/date-from-timestamp';
import { map, Observable } from 'rxjs';
import { SnackbarService } from '../../shared/snackbar.service';

// Embedded (not a dialog) inside CouponDialogComponent, shown only for
// affiliate coupons that already have a code to query by - see
// CouponDialogComponent's own comment on why this differs from the
// original, which always rendered this (and its empty tables) for every
// coupon, affiliate or not.
@Component({
    selector: 'app-affiliate-sales',
    templateUrl: './affiliate-sales.component.html',
    styleUrls: ['./affiliate-sales.component.scss'],
    standalone: false
})
export class AffiliateSalesComponent implements OnChanges {
  @Input() code: string;
  @Input() paypalAccount: string;

  affiliateSales$: Observable<AffilliateSaleModel[]>;
  selection = new SelectionModel<AffilliateSaleModel>(true, []);
  inProgress = false;

  private currentRows: AffilliateSaleModel[] = [];

  constructor(
    private affiliateSalesService: AffilliateSalesService,
    private affilliatePaymentService: AffilliatePaymentsService,
    private snackbar: SnackbarService
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['code'] && this.code) {
      this.selection.clear();
      this.affiliateSales$ = this.affiliateSalesService.streamAllByValue('code', this.code).pipe(
        map((sales) => {
          sales.forEach((sale) => (sale.date = dateFromTimestamp(sale.date as Timestamp) as any));
          this.currentRows = sales;
          return sales;
        })
      );
    }
  }

  isAllSelected(): boolean {
    return this.currentRows.length > 0 && this.currentRows.every((row) => this.selection.isSelected(row));
  }

  masterToggle(): void {
    this.isAllSelected() ? this.selection.clear() : this.currentRows.forEach((row) => this.selection.select(row));
  }

  // NOTE: AffilliatePaymentsService.pay() is a hardcoded stub - see its own
  // comment - not a real PayPal payout. Ported as-is, not "fixed"; real
  // payout integration is out of scope for this migration. This action is
  // never triggered during my own live verification for that reason.
  pay(): void {
    if (this.selection.selected.length === 0) {
      this.snackbar.error('No Sales Selected to pay!');
      return;
    }
    if (this.selection.selected.some((row) => row.isPayed)) {
      this.snackbar.error('The selected Sales include already payed!');
      return;
    }

    this.inProgress = true;
    const rows = this.selection.selected;
    const sum = rows.map((row) => (row.totalAfterDiscount ?? 0) * 0.1).reduce((a, b) => a + b, 0);
    const ids = rows.map((row) => row.id!);

    this.affilliatePaymentService.pay(this.paypalAccount, sum).then(async (response) => {
      const payment: AffilliatePaymentModel = { ...new AffilliatePaymentModel() };
      payment.code = this.code;
      payment.date = Timestamp.now();
      payment.amountPayed = sum;
      payment.saleIdsPayed = ids;
      payment.receipt = response;

      const saved = await this.affilliatePaymentService.add(payment);

      await Promise.all(
        rows.map((row) => {
          row.isPayed = true;
          row.paymentReceipt = saved.id!;
          row.amountPayed = (row.totalAfterDiscount ?? 0) * 0.1;
          return this.affiliateSalesService.update(row.id!, row);
        })
      );

      this.selection.clear();
      this.inProgress = false;
      this.snackbar.success('All Sales Paid!');
    });
  }
}
