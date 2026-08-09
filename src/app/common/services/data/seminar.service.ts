import { Injectable } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { SeminarModel } from 'src/app/common/models/domain/seminar.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class SeminarService extends BaseService<SeminarModel>{
  constructor(public override dao: FirebaseDAO<SeminarModel> ) {
    super(dao)
    this.table="seminars"
    this.fromFirestore = SeminarService.fromFirestore
  }

  static readonly fromFirestore = (data): SeminarModel => {
    data.date = dateFromTimestamp(data.date as Timestamp)
    data.requestedDate = dateFromTimestamp(data.requestedDate as Timestamp)
    data.requestedEndTime = dateFromTimestamp(data.requestedEndTime as Timestamp)
    data.requestedStartTime = dateFromTimestamp(data.requestedStartTime as Timestamp)

    return data;
  };
}
