import { EMailService } from 'src/app/common/services/data/email.service';
import { SubscriptionType } from 'src/app/common/models/domain/utils/customer.model';
import { environment } from 'src/environments/environment';

// Was SubscriptionService.sendConfirmationEmail (subscription.service.ts,
// removed - see customer.model.ts's own comment on why). Single call site
// (SubscriberDialogComponent's "Add" path), so it moved here rather than
// onto CustomerService, which deliberately stays a thin BaseService wrapper
// (see its own file comment) with no manual-entry email side effects.
// Content is unchanged from the original: `type` still picks HTML-with-
// ebook-link (newsletter) vs. plain-text (prayer), and the unsubscribe link
// still carries `&list=subscriptions` even though the Cloud Function no
// longer reads that param (functions/src/subscriptions.functions.ts) - kept
// so this matches the links already sent historically, `type` is the part
// that actually matters now.
export function sendSubscriptionConfirmationEmail(emailService: EMailService, type: SubscriptionType, firstName: string, email: string): void {
  if (type === 'prayer') {
    const subject = 'Thank you for Joining our Prayer Team! ';
    let text = 'Dear ' + firstName + '.\n\n';
    text += 'Your email address was successfully added to our Prayer Team List! (' + email + ')\n\n';
    text += 'God Bless! - Impact Disciples Ministry';

    text += "<br><br><br><div>If you believe you received this confirmation by mistake, please click " +
      "<b><a href='" + environment.unsubscribeUrl + "?email=" + email +
      "&list=subscriptions&type=prayer'>here</a></b> to remove your address.</div>";

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
    "&list=subscriptions&type=newsletter'>here</a></b> to remove your address.</div>";

  emailService.sendHtmlEmail(email, subject, text);
}
