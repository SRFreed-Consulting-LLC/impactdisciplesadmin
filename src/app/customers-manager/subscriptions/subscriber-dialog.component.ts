import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { SubscriptionModel, SubscriptionType } from 'src/app/common/models/domain/subscription.model';
import { SubscriptionService } from 'src/app/common/services/data/subscription.service';
import { SnackbarService } from '../../shared/snackbar.service';

export interface SubscriberDialogData {
  item: SubscriptionModel | null;
}

// Replaces NewsletterSubscriberDialogComponent + PrayerSubscriberDialogComponent
// - same firstName/lastName/email form, plus a Type select (the one field
// that used to be implicit in which of the 2 old screens you were on).
@Component({
    selector: 'app-subscriber-dialog',
    templateUrl: './subscriber-dialog.component.html',
    styleUrls: ['./subscriber-dialog.component.scss'],
    standalone: false
})
export class SubscriberDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;

  private itemType = 'Subscriber';

  constructor(
    private dialogRef: MatDialogRef<SubscriberDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: SubscriberDialogData,
    private fb: FormBuilder,
    private service: SubscriptionService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.form = this.fb.group({
      type: [data.item?.type ?? null, Validators.required],
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
    const { type, firstName, lastName, email } = this.form.value as { type: SubscriptionType; firstName: string; lastName: string; email: string };

    if (this.isEdit) {
      const value: SubscriptionModel = { ...this.data.item, type, firstName, lastName, email };
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
      this.service.createSubscription(type, firstName, lastName, email).then((result) => {
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
