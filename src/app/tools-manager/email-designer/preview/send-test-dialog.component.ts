import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { environment } from 'src/environments/environment';
import { EmailDesign } from 'src/app/common/models/admin/email-design.model';
import { compileEmailDesign } from 'src/app/common/utils/email/email-design-compiler';
import { MergeContext, renderMergeTags, sampleMergeContext } from 'src/app/common/utils/email/merge-tags';
import { EMailService } from 'src/app/common/services/data/email.service';
import { SnackbarService } from 'src/app/shared/snackbar.service';

export interface SendTestDialogData {
  design: EmailDesign;
  subject: string;
  title: string;
  defaultTo: string;
}

// Sends the compiled email (merge tags rendered with sample values, the
// unsubscribe link pointed at the real per-environment endpoint for the
// test recipient) through the same `mail`-collection path every production
// send uses - so a test send exercises the actual delivery pipeline.
@Component({
    selector: 'app-send-test-dialog',
    templateUrl: './send-test-dialog.component.html',
    styleUrls: ['./send-test-dialog.component.scss'],
    standalone: false
})
export class SendTestDialogComponent {
  to: string;
  sending$ = new BehaviorSubject<boolean>(false);

  constructor(
    private dialogRef: MatDialogRef<SendTestDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: SendTestDialogData,
    private emailService: EMailService,
    private snackbar: SnackbarService
  ) {
    this.to = data.defaultTo ?? '';
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onSend(): void {
    const to = this.to.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      this.snackbar.error('Enter a valid email address');
      return;
    }

    this.sending$.next(true);
    const html = compileEmailDesign(this.data.design, { title: this.data.title });
    const context: MergeContext = {
      ...sampleMergeContext(),
      email: to,
      unsubscribeUrl: environment.unsubscribeUrl + '?email=' + encodeURIComponent(to)
    };
    const rendered = renderMergeTags(html, context);
    const subject = '[Test] ' + (this.data.subject || this.data.title || 'Email design test');

    this.emailService.sendHtmlEmail(to, subject, rendered).then((result) => {
      this.sending$.next(false);
      if (result) {
        this.snackbar.success('Test email queued to ' + to);
        this.dialogRef.close(true);
      } else {
        this.snackbar.error('Some Error Occured');
      }
    });
  }
}
