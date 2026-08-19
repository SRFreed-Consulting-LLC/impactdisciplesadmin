import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { Timestamp } from 'firebase/firestore';
import { ContactModel, SubscriptionType, subscriptionFieldsForType } from 'src/app/common/models/domain/utils/contact.model';
import { ContactService } from 'src/app/common/services/data/contact.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ReportRow } from './subscriber-report-row.model';

export interface SubscriberDialogData {
  item: ReportRow;
}

// Edit-only - see subscriber-report.component.ts's own header comment on
// why there's no "add a subscriber manually" path any more (there's no
// manual "New Customer" flow in this app either, see contact.model.ts's
// own comment - a subscriber is a customer, same story). Same firstName/
// lastName/email/Type form the old NewsletterSubscriberDialogComponent/
// PrayerSubscriberDialogComponent had.
@Component({
    selector: 'app-subscriber-dialog',
    templateUrl: './subscriber-dialog.component.html',
    styleUrls: ['./subscriber-dialog.component.scss'],
    standalone: false
})
export class SubscriberDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);

  private itemType = 'Subscriber';

  constructor(
    private dialogRef: MatDialogRef<SubscriberDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: SubscriberDialogData,
    private fb: FormBuilder,
    private service: ContactService,
    private snackbar: SnackbarService
  ) {
    this.form = this.fb.group({
      type: [data.item.type, Validators.required],
      firstName: [data.item.firstName, Validators.required],
      lastName: [data.item.lastName, Validators.required],
      email: [data.item.email, Validators.required]
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

    this.updateExisting(type, firstName, lastName, email).then((result) => {
      if (result) {
        this.snackbar.success(this.itemType + ' Updated');
        this.dialogRef.close(true);
      } else {
        this.inProgress$.next(false);
        this.snackbar.error('Some Error Occured');
      }
    });
  }

  // Moving an existing subscription row from one type to the other flips
  // both flags on the SAME customer doc and re-stamps the date (a fresh
  // "subscribed" moment for the new type); leaving type unchanged only
  // touches name/email, the existing *SubscribedDate is left alone.
  private updateExisting(type: SubscriptionType, firstName: string, lastName: string, email: string): Promise<ContactModel> {
    const original = this.data.item;
    const updated: ContactModel = { ...original.customer, firstName, lastName, email };

    if (type !== original.type) {
      const oldFields = subscriptionFieldsForType(original.type);
      const newFields = subscriptionFieldsForType(type);
      (updated as unknown as Record<string, unknown>)[oldFields.flagField] = false;
      (updated as unknown as Record<string, unknown>)[newFields.flagField] = true;
      (updated as unknown as Record<string, unknown>)[newFields.dateField] = Timestamp.now();
    }

    return this.service.update(original.customer.id!, updated);
  }
}
