import { Injectable } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { CustomerEmailModel } from 'src/app/common/models/domain/customer-email.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class CustomerEmailService extends BaseService<CustomerEmailModel> {
  constructor(public override dao: FirebaseDAO<CustomerEmailModel>) {
    super(dao)
    this.table="customer_emails"
    this.fromFirestore = CustomerEmailService.fromFirestore
  }

  static readonly fromFirestore = (data): CustomerEmailModel => {
    data.date = dateFromTimestamp(data.date as Timestamp)

    return data;
  };
}
