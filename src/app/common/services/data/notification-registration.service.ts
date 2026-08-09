import { Injectable } from '@angular/core';
import { FirebaseDAO } from '../../dao/firebase.dao';
import { NotificationRegistrationModel } from 'src/app/common/models/admin/notification-registration.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { Timestamp } from 'firebase/firestore';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class NotificationRegistrationService extends BaseService<NotificationRegistrationModel>{

  constructor(public override dao: FirebaseDAO<NotificationRegistrationModel>) {
    super(dao)
    this.table="notification_registrations"
    this.fromFirestore = NotificationRegistrationService.fromFirestore
  }

  static readonly fromFirestore = (data): NotificationRegistrationModel => {
    data.dateRegistered = dateFromTimestamp(data.dateRegistered as Timestamp)
    data.dateRemoved = dateFromTimestamp(data.dateRemoved as Timestamp)

    return data;
  };
}
