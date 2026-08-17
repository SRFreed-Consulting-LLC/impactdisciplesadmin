import { Component, Inject } from '@angular/core';
import Quill from 'quill';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { Timestamp } from 'firebase/firestore';
import { SubscriptionType, subscriptionFieldsForType } from 'src/app/common/models/domain/utils/customer.model';
import { CustomerService } from 'src/app/common/services/data/customer.service';
import { NewsletterModel } from 'src/app/common/models/domain/newsletter.model';
import { NewsletterService } from 'src/app/common/services/data/newletter.service';
import { PrayerModel } from 'src/app/common/models/domain/prayer.model';
import { PrayerService } from 'src/app/common/services/data/prayer.service';
import { EMailService } from 'src/app/common/services/data/email.service';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { renderMergeTags } from 'src/app/common/utils/email/merge-tags';
import { environment } from 'src/environments/environment';
import { SnackbarService } from '../../shared/snackbar.service';
import { RICH_TEXT_TOOLBAR } from '../../shared/rich-text-editor/quill-toolbar.config';
import { insertQuillVariable } from '../../shared/rich-text-editor/variable-inserter.component';

export interface SendSubscriptionDialogData {
  // Which audience this send targets - drives the title, the "every
  // subscriber" query (CustomerService.getAllByValue against this type's
  // flag field, NOT a blind getAll() - customers who aren't subscribed to
  // this specific type must never receive it), the archive record written
  // afterward (NewsletterModel vs PrayerModel - see below, that split
  // itself is unchanged/out of scope), and the unsubscribe link's `type`
  // param. Always the WHOLE audience for this type - no way to narrow who
  // a send reaches to some subset (per the user, explicitly - this app
  // doesn't do subscriber sub-lists).
  type: SubscriptionType;
}

// Replaces SendNewsletterDialogComponent + SendPrayerDialogComponent - same
// Quill compose/variable-insert mechanics for both; content/archive-model
// still branches on `type` since Newsletter and Prayer Team retain their
// own distinct outbound-archive collections (newsletters/prayers).
@Component({
    selector: 'app-send-subscription-dialog',
    templateUrl: './send-subscription-dialog.component.html',
    styleUrls: ['./send-subscription-dialog.component.scss'],
    standalone: false
})
export class SendSubscriptionDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  richTextModules = RICH_TEXT_TOOLBAR;

  emailVals: string[] = ['Recipient First Name', 'Recipient Last Name', 'Sender First Name', 'Sender Last Name', 'Date'];

  private quill: Quill | undefined;

  constructor(
    private dialogRef: MatDialogRef<SendSubscriptionDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: SendSubscriptionDialogData,
    private fb: FormBuilder,
    private service: CustomerService,
    private emailService: EMailService,
    private newsletterService: NewsletterService,
    private prayerService: PrayerService,
    private authService: AdminAuthService,
    private snackbar: SnackbarService
  ) {
    this.form = this.fb.group({
      subject: ['', Validators.required],
      html: ['']
    });
  }

  get dialogTitle(): string {
    return this.data.type === 'prayer' ? 'SEND PRAYER REQUEST' : 'SEND NEWSLETTER';
  }

  onEditorCreated(quill: Quill): void {
    this.quill = quill;
  }

  insertVariable(variableName: string): void {
    insertQuillVariable(this.quill, variableName);
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onSend(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.inProgress$.next(true);

    const user = this.authService.getLoggedInUser();
    const date = Timestamp.now();
    const template = this.form.value.html as string;
    const subject = this.form.value.subject as string;
    const type = this.data.type;

    const { flagField } = subscriptionFieldsForType(type);

    this.service.getAllByValue(flagField, true)
      .then((subscribers) => {
        subscribers.forEach((subscriber) => {
          // One engine for all token spellings ({{Recipient First Name}},
          // {{firstName}}, *|FNAME|*), replacing EVERY occurrence - the
          // chained String.replace() this replaces only hit the first one.
          let html = renderMergeTags(template, {
            firstName: subscriber.firstName,
            lastName: subscriber.lastName,
            email: subscriber.email,
            senderFirstName: user.firstName,
            senderLastName: user.lastName,
            date: (dateFromTimestamp(date) as Date).toLocaleString(),
            unsubscribeUrl:
              environment.unsubscribeUrl + '?email=' + encodeURIComponent(subscriber.email) + '&type=' + type
          });
          html +=
            '<br><br><br><div>If you believe you received this email by mistake, please click ' +
            "<b><a href='" + environment.unsubscribeUrl + '?email=' + encodeURIComponent(subscriber.email) +
            "&type=" + type + "'>here</a></b> to remove your address.</div>";

          this.emailService.sendHtmlEmail(subscriber.email, subject, html);
        });
      })
      .then(() => {
        if (type === 'prayer') {
          const prayer: PrayerModel = {
            ...new PrayerModel(),
            date,
            sender: `${user.firstName} ${user.lastName}`,
            subject,
            html: template
          };

          this.prayerService.add(prayer).then(() => {
            this.snackbar.success('Prayer Request Sent Successfully!');
            this.dialogRef.close(true);
          });
          return;
        }

        const newsletter: NewsletterModel = {
          ...new NewsletterModel(),
          date,
          sender: `${user.firstName} ${user.lastName}`,
          subject,
          html: template
        };

        this.newsletterService.add(newsletter).then((result) => {
          this.snackbar.success(`Newsletter ("${result.subject}") Sent Successfully!`);
          this.dialogRef.close(true);
        });
      });
  }
}
