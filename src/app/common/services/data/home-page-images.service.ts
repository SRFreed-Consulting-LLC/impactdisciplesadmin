import { Injectable } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { BaseService } from './base.service';
import { HomePageImageModel } from '@impact-common/shared/models/domain/home-page-image.model';

@Injectable({
  providedIn: 'root'
})
export class HomePageImageService extends BaseService<HomePageImageModel> {
  constructor(public override dao: FirebaseDAO<HomePageImageModel>) {
    super(dao)
    this.table="home_page_images"
    this.fromFirestore = HomePageImageService.fromFirestore
  }

  static readonly fromFirestore = (data): HomePageImageModel => {
    data.date = dateFromTimestamp(data.date as Timestamp)

    return data;
  };
}
