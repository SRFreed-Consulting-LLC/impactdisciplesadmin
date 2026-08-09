import { Injectable } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { BaseService } from './base.service';
import { HomePagePopupModel } from 'src/app/common/models/domain/home-page-popup.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { Timestamp } from 'firebase/firestore';

@Injectable({
  providedIn: 'root'
})
export class HomePagePopUpService extends BaseService<HomePagePopupModel> {
  constructor(public override dao: FirebaseDAO<HomePagePopupModel>) {
    super(dao)
    this.table="home_page_popups"
    this.fromFirestore = HomePagePopUpService.fromFirestore;
  }

  static readonly fromFirestore = (data): HomePagePopupModel => {
    data.fromDate = dateFromTimestamp(data.fromDate as Timestamp);
    data.toDate = dateFromTimestamp(data.toDate as Timestamp);

    return data;
  }
}
