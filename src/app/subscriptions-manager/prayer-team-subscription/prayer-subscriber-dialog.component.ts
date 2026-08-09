import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { PrayerTeamSubscriptionModel } from 'src/app/common/models/domain/prayer-team-subscription.model';
import { PrayerTeamSubscriptionService } from 'src/app/common/services/data/prayer-team-subscription.service';
import { SnackbarService } from '../../shared/snackbar.service';

export interface PrayerSubscriberDialogData {
  item: PrayerTeamSubscriptionModel | null;
}

@Component({
    selector: 'app-prayer-subscriber-dialog',
    templateUrl: './prayer-subscriber-dialog.component.html',
    styleUrls: ['./prayer-subscriber-dialog.component.scss'],
    standalone: false
})
export class PrayerSubscriberDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;

  private itemType = 'Prayer Team Subscription';

  constructor(
    private dialogRef: MatDialogRef<PrayerSubscriberDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: PrayerSubscriberDialogData,
    private fb: FormBuilder,
    private service: PrayerTeamSubscriptionService,
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
      const value: PrayerTeamSubscriptionModel = { ...this.data.item, firstName, lastName, email };
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
      this.service.createPrayerTeamSubscription(firstName, lastName, email).then((result) => {
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
