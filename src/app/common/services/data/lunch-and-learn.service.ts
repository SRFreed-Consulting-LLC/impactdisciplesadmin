import { Injectable } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { LunchAndLearnModel } from 'src/app/common/models/domain/lunch-and-learn.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class LunchAndLearnService extends BaseService<LunchAndLearnModel>{
  constructor(public override dao: FirebaseDAO<LunchAndLearnModel> ) {
    super(dao)
    this.table="lunch_and_learns"
    this.fromFirestore = LunchAndLearnService.fromFirestore
  }

  static readonly fromFirestore = (data): LunchAndLearnModel => {
    data.requestedDate = dateFromTimestamp(data.requestedDate as Timestamp)
    data.requestedEndTime = dateFromTimestamp(data.requestedEndTime as Timestamp)
    data.requestedStartTime = dateFromTimestamp(data.requestedStartTime as Timestamp)

    return data;
  };
}
