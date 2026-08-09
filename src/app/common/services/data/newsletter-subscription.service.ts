import { WhereFilterOperandKeys } from './../../dao/firebase.dao';
import { Injectable } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { FirebaseDAO, QueryParam } from 'src/app/common/dao/firebase.dao';
import { NewsletterSubscriptionModel } from 'src/app/common/models/domain/newsletter-subscription.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { BaseService } from './base.service';
import { environment } from 'src/environments/environment';
import { EMailService } from './email.service';

@Injectable({
  providedIn: 'root'
})
export class NewsletterSubscriptionService extends BaseService<NewsletterSubscriptionModel> {
  constructor(public override dao: FirebaseDAO<NewsletterSubscriptionModel>, private emailService: EMailService ) {
    super(dao)
    this.table="newsletter_subscriptions"
    this.fromFirestore = NewsletterSubscriptionService.fromFirestore
  }

  static readonly fromFirestore = (data): NewsletterSubscriptionModel => {
    data.date = dateFromTimestamp(data.date as Timestamp)

    return data;
  };

  createNewsLetterSubscription(firstName: string, lastName: string, email: string){
    let qp: QueryParam[] = [
      new QueryParam('email', WhereFilterOperandKeys.equal, email),
      new QueryParam('lastName', WhereFilterOperandKeys.equal, lastName),
      new QueryParam('firstName', WhereFilterOperandKeys.equal, firstName)
    ];

    return this.queryAllByMultiValue(qp).then(item => {
      if(!item || item.length == 0){
        let subscriber: NewsletterSubscriptionModel = {...new NewsletterSubscriptionModel()};
        subscriber.firstName = firstName;
        subscriber.lastName = lastName;
        subscriber.email = email;
        subscriber.date = Timestamp.now();
        return this.add(subscriber);
      }

      return Promise.resolve(null);
    })
  }

  sendConfirmationEmail(subscription: NewsletterSubscriptionModel){
    let subject = 'Thank you for Subscribing to the Impact Disciples Newletter!';
    let text = '<div>Dear ' + subscription.firstName + '.</div><br><br>'
    text += '<div>Your email address was successfully added to our Newletter Subsciption List! (' + subscription.email +')</div><br><br>'
    text += '<div>Please accept this free <a href="' + environment.freeEbookUrl +'" download>EBook</a> as a small token of our appreciation.</div><br><br>'
    text +='<div>God Bless! - Impact Disciples Ministry</div>'

    text += "<br><br><br><div>If you believe you received this confirmation by mistake, please click " +
      "<b><a href='" + environment.unsubscribeUrl + "?email="+ subscription.email +
      "&list=newsletter_subscriptions'>here</a></b> to remove your address.</div>"

    this.emailService.sendHtmlEmail(subscription.email, subject, text);
  }
}
