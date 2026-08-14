import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { EmailList } from 'src/app/common/models/utils/email-list.model';
import { SubscriberRow } from './subscriber-row.model';
import { EmailListService } from 'src/app/common/services/data/email-list.service';
import { SnackbarService } from '../../shared/snackbar.service';

export interface SubscriptionListDialogData {
  item: EmailList | null;
  // The subscriber rows currently checked in the main grid - becomes the
  // list's membership, matching the original's onListSave() which set
  // selectedList.list = selectedSubscribers regardless of add vs. edit.
  members: SubscriberRow[];
}

// Replaces NewsletterListDialogComponent + PrayerListDialogComponent - same
// save-as-EmailList mechanic, `type` is now a real form field (previously
// hardcoded per-dialog to 'newsletter'/'prayer') since one dialog now saves
// lists of either kind.
@Component({
    selector: 'app-subscription-list-dialog',
    templateUrl: './subscription-list-dialog.component.html',
    styleUrls: ['./subscription-list-dialog.component.scss'],
    standalone: false
})
export class SubscriptionListDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;

  constructor(
    private dialogRef: MatDialogRef<SubscriptionListDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: SubscriptionListDialogData,
    private fb: FormBuilder,
    private service: EmailListService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.form = this.fb.group({
      type: [data.item?.type ?? null, Validators.required],
      name: [data.item?.name ?? '', Validators.required]
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
    const value: EmailList = {
      ...this.data.item,
      name: this.form.value.name,
      type: this.form.value.type,
      list: this.data.members
    };

    const request = this.isEdit ? this.service.update(value.id!, value) : this.service.add(value);

    request.then((result) => {
      if (result) {
        this.snackbar.success('List ' + (this.isEdit ? 'Updated' : 'Added'));
        this.dialogRef.close(true);
      } else {
        this.inProgress$.next(false);
        this.snackbar.error('Some Error Occured');
      }
    });
  }
}
