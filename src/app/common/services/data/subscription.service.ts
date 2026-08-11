import { Injectable } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { FirebaseDAO, QueryParam, WhereFilterOperandKeys } from 'src/app/common/dao/firebase.dao';
import { SubscriptionModel, SubscriptionType } from 'src/app/common/models/domain/subscription.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { BaseService } from './base.service';
import { environment } from 'src/environments/environment';
import { EMailService } from './email.service';

// Replaces NewsletterSubscriptionService + PrayerTeamSubscriptionService -
// both collections (newsletter_subscriptions, prayer_team_subscriptions)
// merged into one (`subscriptions`), see SubscriptionModel's own comment.
@Injectable({
  providedIn: 'root'
})
export class SubscriptionService extends BaseService<SubscriptionModel> {
  constructor(public override dao: FirebaseDAO<SubscriptionModel>, private emailService: EMailService) {
    super(dao)
    this.table = "subscriptions"
    this.fromFirestore = SubscriptionService.fromFirestore
  }

  static readonly fromFirestore = (data): SubscriptionModel => {
    data.date = dateFromTimestamp(data.date as Timestamp)

    return data;
  };

  // Dedupe now also matches on `type`, not just name+email (the old per-
  // collection behavior) - the same person can independently be a
  // newsletter subscriber AND a prayer team member as two separate docs;
  // matching on name+email alone would incorrectly no-op a second
  // subscription of a different type for someone already on the other list.
  createSubscription(type: SubscriptionType, firstName: string, lastName: string, email: string) {
    const qp: QueryParam[] = [
      new QueryParam('email', WhereFilterOperandKeys.equal, email),
      new QueryParam('lastName', WhereFilterOperandKeys.equal, lastName),
      new QueryParam('firstName', WhereFilterOperandKeys.equal, firstName),
      new QueryParam('type', WhereFilterOperandKeys.equal, type)
    ];

    return this.queryAllByMultiValue(qp).then(item => {
      if (!item || item.length == 0) {
        const subscriber: SubscriptionModel = { ...new SubscriptionModel() };
        subscriber.type = type;
        subscriber.firstName = firstName;
        subscriber.lastName = lastName;
        subscriber.email = email;
        subscriber.date = Timestamp.now();
        return this.add(subscriber);
      }

      return Promise.resolve(null);
    })
  }

  // Content branches on `type` - preserves each type's exact previous
  // subject/body/format (Newsletter: HTML, includes a free ebook link;
  // Prayer: plain text, no ebook link) rather than unifying them, since only
  // the subscriber list/table merged, not the email content itself. The
  // unsubscribe link now points at the merged collection AND carries `type`
  // (not just `email`) - see subscriptions.functions.ts's own comment on
  // why that's required now that both types share one collection.
  sendConfirmationEmail(subscription: SubscriptionModel) {
    if (subscription.type === 'prayer') {
      const subject = 'Thank you for Joining our Prayer Team! ';
      let text = 'Dear ' + subscription.firstName + '.\n\n'
      text += 'Your email address was successfully added to our Prayer Team List! (' + subscription.email + ')\n\n'
      text += 'God Bless! - Impact Disciples Ministry'

      text += "<br><br><br><div>If you believe you received this confirmation by mistake, please click " +
        "<b><a href='" + environment.unsubscribeUrl + "?email=" + subscription.email +
        "&list=subscriptions&type=prayer'>here</a></b> to remove your address.</div>"

      this.emailService.sendTextEmail(subscription.email, subject, text);
      return;
    }

    const subject = 'Thank you for Subscribing to the Impact Disciples Newletter!';
    let text = '<div>Dear ' + subscription.firstName + '.</div><br><br>'
    text += '<div>Your email address was successfully added to our Newletter Subsciption List! (' + subscription.email + ')</div><br><br>'
    text += '<div>Please accept this free <a href="' + environment.freeEbookUrl + '" download>EBook</a> as a small token of our appreciation.</div><br><br>'
    text += '<div>God Bless! - Impact Disciples Ministry</div>'

    text += "<br><br><br><div>If you believe you received this confirmation by mistake, please click " +
      "<b><a href='" + environment.unsubscribeUrl + "?email=" + subscription.email +
      "&list=subscriptions&type=newsletter'>here</a></b> to remove your address.</div>"

    this.emailService.sendHtmlEmail(subscription.email, subject, text);
  }
}
