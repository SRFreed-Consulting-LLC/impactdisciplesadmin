import { Injectable } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { PrayerModel } from 'src/app/common/models/domain/prayer.model';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class PrayerService extends BaseService<PrayerModel>{
  constructor(public override dao: FirebaseDAO<PrayerModel> ) {
    super(dao)
    this.table="prayers"
  }
}
