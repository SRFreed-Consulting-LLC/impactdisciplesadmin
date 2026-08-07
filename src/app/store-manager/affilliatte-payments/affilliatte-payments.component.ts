import { Component, Input, OnInit } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { AffilliatePaymentModel } from 'impactdisciplescommon/src/models/utils/affilliate-payment.model';
import { CouponModel } from 'impactdisciplescommon/src/models/utils/coupon.model';
import { AffilliatePaymentsService } from 'impactdisciplescommon/src/services/data/affiliate-payment.service';
import { dateFromTimestamp } from 'impactdisciplescommon/src/utils/date-from-timestamp';
import { map, Observable } from 'rxjs';

@Component({
    selector: 'app-affilliatte-payments',
    templateUrl: './affilliatte-payments.component.html',
    styleUrls: ['./affilliatte-payments.component.css'],
    standalone: false
})
export class AffilliattePaymentsComponent implements OnInit {
  @Input('selectedItem') selectedItem: CouponModel;

  affilliatePayments: Observable<AffilliatePaymentModel[]>;

  constructor(private affilliatePaymentService: AffilliatePaymentsService) { }

  async ngOnInit() {
    this.affilliatePayments = await this.affilliatePaymentService.streamAllByValue("code", this.selectedItem.code).pipe(
      map(payments => {
        payments.forEach(payment => payment.date = dateFromTimestamp(payment.date as Timestamp))
        return payments;
      })
    );
  }

}
