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

  // Hardcoded stub, not a real PayPal payout - see affiliate-sales.component.ts's
  // own comment on pay(). Params are part of the intended real signature,
  // kept even though unused by this placeholder body.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  pay(affiliatePaypalAccount: string, amount: number): Promise<string>{
    return Promise.resolve('asdsaerwerwer');
  }
}
