import { Injectable } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { PodCastModel } from 'src/app/common/models/domain/pod-cast.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { BaseService } from './base.service';
import { MonthlyNewsletterModel } from 'src/app/common/models/domain/monthly-newsletter.model';

@Injectable({
  providedIn: 'root'
})
export class MonthlyNewletterService extends BaseService<MonthlyNewsletterModel>{
  constructor(public override dao: FirebaseDAO<MonthlyNewsletterModel> ) {
    super(dao)
    this.table="monthly-newsletter"
    this.fromFirestore = MonthlyNewletterService.fromFirestore
  }

  static readonly fromFirestore = (data): PodCastModel => {
    data.date = dateFromTimestamp(data.date as Timestamp)

    return data;
  };
}


