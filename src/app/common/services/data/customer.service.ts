import { Injectable } from '@angular/core';
import { CustomerModel } from 'src/app/common/models/domain/utils/customer.model';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { BaseService } from './base.service';

// Customer records are created/kept up to date entirely server-side now -
// see functions/src/customer-upsert.functions.ts's onPurchaseCustomerUpsert
// trigger, which runs on every new purchase. This service used to also own
// createCustomerAccount() (a client-side create-only helper the storefront's
// checkout never actually called - dead code, and it couldn't have updated
// an existing customer anyway) - removed rather than ported, since the real
// upsert-with-diff logic has to live server-side regardless (the client SDK
// has no business deciding whether a mismatch is safe to auto-apply).
@Injectable({
  providedIn: 'root'
})
export class CustomerService extends BaseService<CustomerModel>{
  constructor(public override dao: FirebaseDAO<CustomerModel>) {
    super(dao)
    this.table="customers"
  }
}
