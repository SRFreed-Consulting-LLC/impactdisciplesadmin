import { Component, Inject } from '@angular/core';
import Quill from 'quill';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { Timestamp } from 'firebase/firestore';
import { CustomerEmailModel } from 'src/app/common/models/domain/customer-email.model';
import { CustomerEmailService } from 'src/app/common/services/data/customer-email.service';
import { EventRegistrationService } from 'src/app/common/services/data/event-registration.service';
import { EMailService } from 'src/app/common/services/data/email.service';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { renderMergeTags } from 'src/app/common/utils/email/merge-tags';
import { SnackbarService } from '../../../shared/snackbar.service';
import { RICH_TEXT_TOOLBAR } from '../../../shared/rich-text-editor/quill-toolbar.config';
import { insertQuillVariable } from '../../../shared/rich-text-editor/variable-inserter.component';

export interface EventEmailDialogData {
  eventId: string | undefined;
}

// Copy of SendNewsletterDialogComponent's pattern (subject + quill body +
// variable insertion), scoped to this event's own registrants instead of
// a newsletter subscriber list.
@Component({
    selector: 'app-event-email-dialog',
    templateUrl: './event-email-dialog.component.html',
    styleUrls: ['./event-email-dialog.component.scss'],
    standalone: false
})
export class EventEmailDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  richTextModules = RICH_TEXT_TOOLBAR;

  emailVals: string[] = ['Recipient First Name', 'Recipient Last Name', 'Sender First Name', 'Sender Last Name', 'Date'];

  private quill: Quill | undefined;

  constructor(
    private dialogRef: MatDialogRef<EventEmailDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: EventEmailDialogData,
    private fb: FormBuilder,
    private service: EventRegistrationService,
    private emailService: EMailService,
    private customerEmailService: CustomerEmailService,
    private authService: AdminAuthService,
    private snackbar: SnackbarService
  ) {
    this.form = this.fb.group({
      subject: ['', Validators.required],
      html: ['']
    });
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
    if (this.form.invalid || !this.data.eventId) {
      this.form.markAllAsTouched();
      return;
    }

    this.inProgress$.next(true);

    const user = this.authService.getLoggedInUser();
    const date = Timestamp.now();
    const template = this.form.value.html as string;
    const subject = this.form.value.subject as string;
    const email: CustomerEmailModel = { ...new CustomerEmailModel(), date, sender: `${user.firstName} ${user.lastName}`, subject, html: template };

    this.service.getAllByValue('eventId', this.data.eventId).then((subscribers) => {
      subscribers.forEach((subscriber) => {
        // One engine for all token spellings ({{Recipient First Name}},
        // {{firstName}}, *|FNAME|*), replacing EVERY occurrence - the
        // chained String.replace() this replaces only hit the first one.
        // No unsubscribeUrl in the context on purpose (see the comment
        // below about the removed unsubscribe link).
        const html = renderMergeTags(template, {
          firstName: subscriber.firstName,
          lastName: subscriber.lastName,
          email: subscriber.email,
          senderFirstName: user.firstName,
          senderLastName: user.lastName,
          date: (dateFromTimestamp(date) as Date).toLocaleString()
        });

        // 2026-08-12 fullsweep fix: this used to append an unsubscribe link
        // hardcoding &list=newsletter_subscriptions, which the backing
        // Cloud Function (unsubscribe_from_email_list) rejects outright -
        // it only accepts list=subscriptions. Event registrants aren't even
        // in that collection (they're in event_registrations), so pointing
        // this at the newsletter's list=subscriptions&type=newsletter
        // pattern instead would be wrong too: it'd either still 400 for a
        // non-subscriber, or silently unsubscribe someone from the
        // newsletter if they happen to share that email. Removed until a
        // real per-event opt-out mechanism exists - see the fullsweep
        // report for the fuller writeup.
        this.emailService.sendHtmlEmail(subscriber.email, subject, html);
      });
    }).then(() => {
      this.customerEmailService.add(email).then((result) => {
        this.snackbar.success(`Email ("${result.subject}") Sent Successfully!`);
        this.dialogRef.close(true);
      });
    });
  }
}
