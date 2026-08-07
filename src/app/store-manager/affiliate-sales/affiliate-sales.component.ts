import { Component, Input, OnInit } from '@angular/core';
import notify from 'devextreme/ui/notify';
import { Timestamp } from 'firebase/firestore';
import { AffilliatePaymentModel } from 'impactdisciplescommon/src/models/utils/affilliate-payment.model';
import { AffilliateSaleModel } from 'impactdisciplescommon/src/models/utils/affilliate-sale.model';
import { CouponModel } from 'impactdisciplescommon/src/models/utils/coupon.model';
import { AffilliatePaymentsService } from 'impactdisciplescommon/src/services/data/affiliate-payment.service';
import { AffilliateSalesService } from 'impactdisciplescommon/src/services/data/affiliate-sales.service';
import { dateFromTimestamp } from 'impactdisciplescommon/src/utils/date-from-timestamp';
import { map, Observable } from 'rxjs';

@Component({
    selector: 'app-affiliate-sales',
    templateUrl: './affiliate-sales.component.html',
    styleUrls: ['./affiliate-sales.component.css'],
    standalone: false
})
export class AffiliateSalesComponent implements OnInit {
  @Input('selectedItem') selectedItem: CouponModel;

  affilliateSales: Observable<AffilliateSaleModel[]>;

  selectedRows: AffilliateSaleModel[] = [];

  constructor(private affiliateSalesService: AffilliateSalesService, private affilliatePaymentService: AffilliatePaymentsService) { }

  async ngOnInit() {
    this.affilliateSales = await this.affiliateSalesService.streamAllByValue("code", this.selectedItem.code).pipe(
      map(sales => {
        sales.forEach(sale => sale.date = dateFromTimestamp(sale.date as Timestamp))
        return sales;
      })
    );
  }

  pay = async () => {
    if(this.selectedRows.length == 0){
      notify({
        message: 'No Sales Selected to pay!',
        position: 'top',
        width: 600,
        type: 'warning'
      });
    }  else if(this.selectedRows.find(x => x.isPayed == true)){
      notify({
        message: 'The selected Sales include already payed!',
        position: 'top',
        width: 600,
        type: 'warning'
      });
    } else {
      let sum: number = this.selectedRows.map(row => row.totalAfterDiscount * .1).reduce((a,b) => a + b, 0);
      let ids: string[] = this.selectedRows.map(row => row.id)

      await this.affilliatePaymentService.pay(this.selectedItem.affiliatePaypalAccount, sum).then(async response => {
        //  create payment record
        let payment: AffilliatePaymentModel = {... new AffilliatePaymentModel()}
        payment.code = this.selectedItem.code;
        payment.date = Timestamp.now();
        payment.amountPayed = sum;
        payment.saleIdsPayed = ids;
        payment.receipt = response;

        payment = await this.affilliatePaymentService.add(payment);

        //  update sales record
        this.selectedRows.forEach(async row => {
          row.isPayed = true;
          row.paymentReceipt = payment.id;
          row.amountPayed = row.totalAfterDiscount * .1;

          await this.affiliateSalesService.update(row.id, row);
        })
      })

      notify({
        message: 'All Sales Paid!',
        position: 'top',
        width: 600,
        type: 'success'
      });
    }
  }

}
