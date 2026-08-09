import { Injectable } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { FirebaseDAO, QueryParam, WhereFilterOperandKeys } from 'src/app/common/dao/firebase.dao';
import { PrayerTeamSubscriptionModel } from 'src/app/common/models/domain/prayer-team-subscription.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { BaseService } from './base.service';
import { environment } from 'src/environments/environment';
import { EMailService } from './email.service';

@Injectable({
  providedIn: 'root'
})
export class PrayerTeamSubscriptionService extends BaseService<PrayerTeamSubscriptionModel> {
  constructor(public override dao: FirebaseDAO<PrayerTeamSubscriptionModel>, private emailService: EMailService ) {
    super(dao)
    this.table="prayer_team_subscriptions"
    this.fromFirestore = PrayerTeamSubscriptionService.fromFirestore
  }

  static readonly fromFirestore = (data): PrayerTeamSubscriptionModel => {
    data.date = dateFromTimestamp(data.date as Timestamp)

    return data;
  };

  createPrayerTeamSubscription(firstName: string, lastName: string, email: string){
    let qp: QueryParam[] = [
      new QueryParam('email', WhereFilterOperandKeys.equal, email),
      new QueryParam('lastName', WhereFilterOperandKeys.equal, lastName),
      new QueryParam('firstName', WhereFilterOperandKeys.equal, firstName)
    ];

    return this.queryAllByMultiValue(qp).then(item => {
      if(!item || item.length == 0){
        let subscriber: PrayerTeamSubscriptionModel = {...new PrayerTeamSubscriptionModel()};
        subscriber.firstName = firstName;
        subscriber.lastName = lastName;
        subscriber.email = email;
        subscriber.date = Timestamp.now();
        return this.add(subscriber);
      }

      return Promise.resolve(null);
    })
  }

  sendConfirmationEmail(subscriber: PrayerTeamSubscriptionModel){
    let subject = 'Thank you for Joining our Prayer Team! ';
    let text = 'Dear ' + subscriber.firstName + '.\n\n'
    text += 'Your email address was successfully added to our Prayer Team List! (' + subscriber.email +')\n\n'
    text +='God Bless! - Impact Disciples Ministry'

    text += "<br><br><br><div>If you believe you received this confirmation by mistake, please click " +
      "<b><a href='" + environment.unsubscribeUrl + "?email="+ subscriber.email +
      "&list=prayer_team_subscriptions'>here</a></b> to remove your address.</div>"

    this.emailService.sendTextEmail(subscriber.email, subject, text);
  }
}
