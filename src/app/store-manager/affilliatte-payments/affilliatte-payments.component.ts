import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { AffilliatePaymentModel } from 'src/app/common/models/utils/affilliate-payment.model';
import { AffilliatePaymentsService } from 'src/app/common/services/data/affiliate-payment.service';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { map, Observable } from 'rxjs';

// Embedded (not a dialog) inside CouponDialogComponent, alongside
// AffiliateSalesComponent - see its own comment for why this is now
// gated to affiliate coupons with a saved code, rather than always shown.
@Component({
    selector: 'app-affilliatte-payments',
    templateUrl: './affilliatte-payments.component.html',
    styleUrls: ['./affilliatte-payments.component.scss'],
    standalone: false
})
export class AffilliattePaymentsComponent implements OnChanges {
  @Input() code: string;

  affiliatePayments$: Observable<AffilliatePaymentModel[]>;

  constructor(private affilliatePaymentService: AffilliatePaymentsService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['code'] && this.code) {
      this.affiliatePayments$ = this.affilliatePaymentService.streamAllByValue('code', this.code).pipe(
        map((payments) => {
          payments.forEach((payment) => (payment.date = dateFromTimestamp(payment.date as Timestamp) as unknown as Timestamp));
          return payments;
        })
      );
    }
  }
}
