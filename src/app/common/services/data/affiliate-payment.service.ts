import { Injectable } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { AffilliatePaymentModel } from 'src/app/common/models/utils/affilliate-payment.model';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class AffilliatePaymentsService extends BaseService<AffilliatePaymentModel>{
  constructor(public override dao: FirebaseDAO<AffilliatePaymentModel>) {
    super(dao)
    this.table="affilliate_payments"
  }
}
