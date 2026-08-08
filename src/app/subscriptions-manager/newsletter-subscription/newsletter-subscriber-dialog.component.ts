import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { NewsletterSubscriptionModel } from 'impactdisciplescommon/src/models/domain/newsletter-subscription.model';
import { NewsletterSubscriptionService } from 'impactdisciplescommon/src/services/data/newsletter-subscription.service';
import { SnackbarService } from '../../shared/snackbar.service';

export interface NewsletterSubscriberDialogData {
  item: NewsletterSubscriptionModel | null;
}

@Component({
    selector: 'app-newsletter-subscriber-dialog',
    templateUrl: './newsletter-subscriber-dialog.component.html',
    styleUrls: ['./newsletter-subscriber-dialog.component.scss'],
    standalone: false
})
export class NewsletterSubscriberDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;

  private itemType = 'Newsletter Subscription';

  constructor(
    private dialogRef: MatDialogRef<NewsletterSubscriberDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: NewsletterSubscriberDialogData,
    private fb: FormBuilder,
    private service: NewsletterSubscriptionService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.form = this.fb.group({
      firstName: [data.item?.firstName ?? '', Validators.required],
      lastName: [data.item?.lastName ?? '', Validators.required],
      email: [data.item?.email ?? '', Validators.required]
    });
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.inProgress$.next(true);
    const { firstName, lastName, email } = this.form.value;

    if (this.isEdit) {
      const value: NewsletterSubscriptionModel = { ...this.data.item, firstName, lastName, email };
      this.service.update(value.id!, value).then((result) => {
        if (result) {
          this.snackbar.success(this.itemType + ' Updated');
          this.dialogRef.close(true);
        } else {
          this.inProgress$.next(false);
          this.snackbar.error('Some Error Occured');
        }
      });
    } else {
      this.service.createNewsLetterSubscription(firstName, lastName, email).then((result) => {
        if (result) {
          this.snackbar.success(this.itemType + ' Added');
          this.service.sendConfirmationEmail(result);
          this.dialogRef.close(true);
        } else {
          this.inProgress$.next(false);
          this.snackbar.error('Some Error Occured');
        }
      });
    }
  }
}
