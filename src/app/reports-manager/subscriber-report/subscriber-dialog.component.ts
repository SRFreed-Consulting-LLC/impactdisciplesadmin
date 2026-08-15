import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { Timestamp } from 'firebase/firestore';
import { CustomerModel, SubscriptionType, subscriptionFieldsForType } from 'src/app/common/models/domain/utils/customer.model';
import { CustomerService } from 'src/app/common/services/data/customer.service';
import { EMailService } from 'src/app/common/services/data/email.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ReportRow } from './subscriber-report-row.model';
import { sendSubscriptionConfirmationEmail } from './subscription-confirmation-email.util';

export interface SubscriberDialogData {
  // Only ever passed with `customer` set (see SubscriberReportComponent's
  // showEditModal(), which refuses to open this dialog for a grouped
  // aggregate row) - narrowed to that effect below rather than threading
  // ReportRow's optional `customer` through this whole file.
  item: (ReportRow & { customer: CustomerModel }) | null;
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
    private service: CustomerService,
    private emailService: EMailService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item;
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

    const request = this.isEdit ? this.updateExisting(type, firstName, lastName, email) : this.subscribeCustomer(type, firstName, lastName, email);

    request.then((result) => {
      if (result) {
        this.snackbar.success(this.itemType + (this.isEdit ? ' Updated' : ' Added'));
        if (!this.isEdit) {
          sendSubscriptionConfirmationEmail(this.emailService, type, firstName, email);
        }
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
  private updateExisting(type: SubscriptionType, firstName: string, lastName: string, email: string): Promise<CustomerModel> {
    const original = this.data.item!;
    const updated: CustomerModel = { ...original.customer, firstName, lastName, email };

    if (type !== original.type) {
      const oldFields = subscriptionFieldsForType(original.type);
      const newFields = subscriptionFieldsForType(type);
      (updated as unknown as Record<string, unknown>)[oldFields.flagField] = false;
      (updated as unknown as Record<string, unknown>)[newFields.flagField] = true;
      (updated as unknown as Record<string, unknown>)[newFields.dateField] = Timestamp.now();
    }

    return this.service.update(original.customer.id!, updated);
  }

  // Mirrors subscribe_to_email_list's own behavior (functions/src/
  // subscriptions.functions.ts) for consistency between the 2 subscribe
  // entry points - matched by email (trimmed/lowercased, same convention as
  // every other customer-record writer, see customer-upsert.functions.ts).
  // An existing customer match only gets the flag/date merged in - name/
  // email on file aren't overwritten from what could be a stale or
  // mistyped manual entry here.
  private subscribeCustomer(type: SubscriptionType, firstName: string, lastName: string, email: string): Promise<CustomerModel> {
    const normalizedEmail = email.trim().toLowerCase();
    const { flagField, dateField } = subscriptionFieldsForType(type);
    const now = Timestamp.now();

    return this.service.getAllByValue('email', normalizedEmail).then((matches) => {
      if (!matches || matches.length === 0) {
        const customer: CustomerModel = {
          ...new CustomerModel(),
          firstName,
          lastName,
          email: normalizedEmail,
          [flagField]: true,
          [dateField]: now
        };
        return this.service.add(customer);
      }

      const existing = matches[0];
      const updated: CustomerModel = { ...existing, [flagField]: true, [dateField]: now };
      return this.service.update(existing.id!, updated);
    });
  }
}
