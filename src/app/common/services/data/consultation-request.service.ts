import { Injectable } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { BaseService } from './base.service';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { ConsultationRequestModel } from 'src/app/common/models/domain/consultation-request.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';


@Injectable({
  providedIn: 'root'
})
export class ConsultationRequestService extends BaseService<ConsultationRequestModel> {
  constructor(public override dao: FirebaseDAO<ConsultationRequestModel> ) {
    super(dao)
    this.table="consultation_requests"
    this.fromFirestore = ConsultationRequestService.fromFirestore
  }

  static readonly fromFirestore = (data): ConsultationRequestModel => {
    data.date = dateFromTimestamp(data.date as Timestamp)

    return data;
  };
}
