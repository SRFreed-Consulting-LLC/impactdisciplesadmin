import { Injectable } from '@angular/core';
import { FirebaseDAO } from '../../dao/firebase.dao';
import { DMMModel } from '../../models/domain/dmm.model';
import { BaseService } from './base.service';
import { dateFromTimestamp } from '../../utils/date-from-timestamp';
import { Timestamp } from 'firebase/firestore';

@Injectable({
  providedIn: 'root'
})
export class DMMService extends BaseService<DMMModel>{
  constructor(public override dao: FirebaseDAO<DMMModel> ) {
    super(dao)
    this.table="dmms"
    this.fromFirestore = DMMService.fromFirestore
  }

  static readonly fromFirestore = (data): DMMModel => {
    data.date = dateFromTimestamp(data.date as Timestamp)

    return data;
  };
}
