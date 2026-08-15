import { EMailService } from 'src/app/common/services/data/email.service';
import { SubscriptionType } from 'src/app/common/models/domain/utils/customer.model';
import { environment } from 'src/environments/environment';

// Was SubscriptionService.sendConfirmationEmail (subscription.service.ts,
// removed - see customer.model.ts's own comment on why), then lived on the
// old Subscribers screen (customers-manager/subscriptions/, removed once
// its functionality folded into this report - see this folder's own
// history). Single call site (SubscriberDialogComponent's "Add" path), so
// it stays a standalone util rather than living on CustomerService, which
// deliberately stays a thin BaseService wrapper (see its own file comment)
// with no manual-entry email side effects. Content is unchanged from the
// original: `type` still picks HTML-with-ebook-link (newsletter) vs.
// plain-text (prayer). `&list=subscriptions` dropped from the unsubscribe
// link now that the collection itself is gone (see MIGRATION.md) - the
// Cloud Function already ignores that param, this just stops generating it
// in brand-new emails.
export function sendSubscriptionConfirmationEmail(emailService: EMailService, type: SubscriptionType, firstName: string, email: string): void {
  if (type === 'prayer') {
    const subject = 'Thank you for Joining our Prayer Team! ';
    let text = 'Dear ' + firstName + '.\n\n';
    text += 'Your email address was successfully added to our Prayer Team List! (' + email + ')\n\n';
    text += 'God Bless! - Impact Disciples Ministry';

    text += "<br><br><br><div>If you believe you received this confirmation by mistake, please click " +
      "<b><a href='" + environment.unsubscribeUrl + "?email=" + email +
      "&type=prayer'>here</a></b> to remove your address.</div>";

    emailService.sendTextEmail(email, subject, text);
    return;
  }

  const subject = 'Thank you for Subscribing to the Impact Disciples Newletter!';
  let text = '<div>Dear ' + firstName + '.</div><br><br>';
  text += '<div>Your email address was successfully added to our Newletter Subsciption List! (' + email + ')</div><br><br>';
  text += '<div>Please accept this free <a href="' + environment.freeEbookUrl + '" download>EBook</a> as a small token of our appreciation.</div><br><br>';
  text += '<div>God Bless! - Impact Disciples Ministry</div>';

  text += "<br><br><br><div>If you believe you received this confirmation by mistake, please click " +
    "<b><a href='" + environment.unsubscribeUrl + "?email=" + email +
    "&type=newsletter'>here</a></b> to remove your address.</div>";

  emailService.sendHtmlEmail(email, subject, text);
}
