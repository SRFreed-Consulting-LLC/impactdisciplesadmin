import { Injectable } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { BaseService } from './base.service';
import { ShippingLabelBatchRequest } from '@impact-common/shared/models/domain/shipment-label-batch-request.model';
import { dateFromTimestamp } from '@impact-common/shared/utils/date-from-timestamp';
import { Timestamp } from 'firebase/firestore';

@Injectable({
  providedIn: 'root'
})
export class ShippingLabelBatchService extends BaseService<ShippingLabelBatchRequest>{

  constructor(public override dao: FirebaseDAO<ShippingLabelBatchRequest>) {
    super(dao)
    this.table="shipping-label-batches"
    this.fromFirestore = ShippingLabelBatchService.fromFirestore
  }

  static readonly fromFirestore = (data): ShippingLabelBatchRequest => {
    data.createdDate = dateFromTimestamp(data.createdDate as Timestamp)
    return data;
  };
}
