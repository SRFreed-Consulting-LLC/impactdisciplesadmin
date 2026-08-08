import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { Timestamp } from 'firebase/firestore';
import { PrayerTeamSubscriptionModel } from 'impactdisciplescommon/src/models/domain/prayer-team-subscription.model';
import { PrayerTeamSubscriptionService } from 'impactdisciplescommon/src/services/data/prayer-team-subscription.service';
import { PrayerModel } from 'impactdisciplescommon/src/models/domain/prayer.model';
import { PrayerService } from 'impactdisciplescommon/src/services/data/prayer.service';
import { EmailList } from 'impactdisciplescommon/src/models/utils/email-list.model';
import { EMailService } from 'impactdisciplescommon/src/services/data/email.service';
import { AdminAuthService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';
import { dateFromTimestamp } from 'impactdisciplescommon/src/utils/date-from-timestamp';
import { environment } from 'src/environments/environment';
import { SnackbarService } from '../../shared/snackbar.service';
import { RICH_TEXT_TOOLBAR } from '../../shared/rich-text-editor/quill-toolbar.config';
import { insertQuillVariable } from '../../shared/rich-text-editor/variable-inserter.component';

export interface SendPrayerDialogData {
  // When set (the "Filter by List" dropdown has an active selection), the
  // prayer request goes to that list's members; otherwise it goes to every
  // subscriber - matches the original's selectedList ? selectedList.list :
  // service.getAll().
  selectedList: EmailList | undefined;
}

@Component({
    selector: 'app-send-prayer-dialog',
    templateUrl: './send-prayer-dialog.component.html',
    styleUrls: ['./send-prayer-dialog.component.scss'],
    standalone: false
})
export class SendPrayerDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  richTextModules = RICH_TEXT_TOOLBAR;

  emailVals: string[] = ['Recipient First Name', 'Recipient Last Name', 'Sender First Name', 'Sender Last Name', 'Date'];

  private quill: any;

  constructor(
    private dialogRef: MatDialogRef<SendPrayerDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: SendPrayerDialogData,
    private fb: FormBuilder,
    private service: PrayerTeamSubscriptionService,
    private emailService: EMailService,
    private prayerService: PrayerService,
    private authService: AdminAuthService,
    private snackbar: SnackbarService
  ) {
    this.form = this.fb.group({
      subject: ['', Validators.required],
      html: ['']
    });
  }

  onEditorCreated(quill: any): void {
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

    const list: Promise<PrayerTeamSubscriptionModel[]> = this.data.selectedList
      ? Promise.resolve(this.data.selectedList.list)
      : this.service.getAll();

    list
      .then((subscribers) => {
        subscribers.forEach((subscriber) => {
          let html = template
            .replace('{{Recipient First Name}}', subscriber.firstName)
            .replace('{{Recipient Last Name}}', subscriber.lastName)
            .replace('{{Sender First Name}}', user.firstName)
            .replace('{{Sender Last Name}}', user.lastName)
            .replace('{{Date}}', (dateFromTimestamp(date) as Date).toLocaleString());
          html +=
            '<br><br><br><div>If you believe you received this email by mistake, please click ' +
            "<b><a href='" + environment.unsubscribeUrl + '?email=' + subscriber.email +
            "&list=prayer_team_subscriptions'>here</a></b> to remove your address.</div>";

          this.emailService.sendHtmlEmail(subscriber.email, subject, html);
        });
      })
      .then(() => {
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
      });
  }
}
