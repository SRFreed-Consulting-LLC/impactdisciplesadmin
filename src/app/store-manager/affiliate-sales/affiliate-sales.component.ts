import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { AffilliateSaleModel } from '@impact-common/shared/models/utils/affilliate-sale.model';
import { AffilliateSalesService } from 'src/app/common/services/data/affiliate-sales.service';
import { dateFromTimestamp } from '@impact-common/shared/utils/date-from-timestamp';
import { map, Observable } from 'rxjs';
import { DataGridColumn } from '../../shared/data-grid/data-grid.model';

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

  columns: DataGridColumn<AffilliateSaleModel>[] = [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'email', label: 'Email' },
    { key: 'totalBeforeDiscount', label: 'Total', type: 'currency' },
    { key: 'totalAfterDiscount', label: 'Discounted Total', type: 'currency' },
    { key: 'amountPayed', label: 'Payed Amount', type: 'currency' },
    { key: 'isPayed', label: 'Paid', value: (item) => (item.isPayed ? 'Yes' : 'No') }
  ];

  constructor(private affiliateSalesService: AffilliateSalesService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['code'] && this.code) {
      this.affiliateSales$ = this.affiliateSalesService.streamAllByValue('code', this.code).pipe(
        map((sales) => {
          sales.forEach((sale) => (sale.date = dateFromTimestamp(sale.date as Timestamp) as unknown as Timestamp));
          return sales;
        })
      );
    }
  }
}
