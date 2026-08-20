import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { CampaignEmailModel } from 'src/app/common/models/domain/campaign-email.model';
import { CampaignEmailService } from 'src/app/common/services/data/campaign-email.service';
import { SnackbarService } from '../../shared/snackbar.service';

export interface PublishWebDialogData {
  touch: CampaignEmailModel;
}

// "Show on website" for one sent touch (2026-08-20): sets the touch's
// publishToWeb flag + optional public title, which is all the public
// Monthly Newsletter page reads (through the newsletter_archive function -
// see CampaignEmailModel's comment). This replaced the Content Manager's
// Monthly Newsletters screen, whose rows were hand-pasted Mailchimp links.
@Component({
    selector: 'app-publish-web-dialog',
    templateUrl: './publish-web-dialog.component.html',
    styleUrls: ['./publish-web-dialog.component.scss'],
    standalone: false
})
export class PublishWebDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);

  constructor(
    private dialogRef: MatDialogRef<PublishWebDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: PublishWebDialogData,
    private fb: FormBuilder,
    private emailService: CampaignEmailService,
    private snackbar: SnackbarService
  ) {
    const touch = data.touch;
    this.form = this.fb.group({
      publishToWeb: [touch.publishToWeb === true],
      webTitle: [touch.webTitle || touch.label || touch.subject || '']
    });
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  async onSave(): Promise<void> {
    this.inProgress$.next(true);
    const publishToWeb = this.form.value.publishToWeb === true;
    const webTitle = String(this.form.value.webTitle ?? '').trim();
    try {
      // Partial update on purpose: a touch carries the html snapshot,
      // link map and stats - never round-trip the whole doc from here.
      await this.emailService.setPublishToWeb(this.data.touch.id!, publishToWeb, webTitle || null);
      this.snackbar.success(publishToWeb ? 'Shown on website' : 'Removed from website');
      this.dialogRef.close(true);
    } catch (err) {
      this.inProgress$.next(false);
      this.snackbar.error('Save failed: ' + ((err as Error)?.message ?? err));
    }
  }
}
