import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { EventRegistrationModel } from 'src/app/common/models/domain/event-registration.model';
import { EventRegistrationService } from 'src/app/common/services/data/event-registration.service';
import { EMailService } from 'src/app/common/services/data/email.service';
import { SnackbarService } from '../../../shared/snackbar.service';

export interface EventAttendeeDialogData {
  item: EventRegistrationModel | null;
  eventId: string | undefined;
}

@Component({
    selector: 'app-event-attendee-dialog',
    templateUrl: './event-attendee-dialog.component.html',
    styleUrls: ['./event-attendee-dialog.component.scss'],
    standalone: false
})
export class EventAttendeeDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;

  private itemType = 'Registered User';

  constructor(
    private dialogRef: MatDialogRef<EventAttendeeDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: EventAttendeeDialogData,
    private fb: FormBuilder,
    private service: EventRegistrationService,
    private emailService: EMailService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;

    this.form = this.fb.group({
      firstName: [data.item?.firstName ?? '', Validators.required],
      lastName: [data.item?.lastName ?? '', Validators.required],
      email: [data.item?.email ?? '', Validators.required],
      registrationDate: [this.toInputValue(data.item?.registrationDate)],
      receipt: [data.item?.receipt ?? '', Validators.required]
    });
  }

  private toInputValue(date: any): string {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  resendEmail(): void {
    if (!this.data.item?.receiptEmailId) {
      return;
    }
    this.emailService.getById(this.data.item.receiptEmailId).then((mail: any) => {
      delete mail['delivery'];
      return mail;
    }).then((mail) => {
      this.emailService.update(mail.id, mail).then(() => {
        this.snackbar.success('Email Resent Successfully!');
      });
    });
  }

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.inProgress$.next(true);
    const raw = this.form.getRawValue();
    const value: EventRegistrationModel = {
      ...this.data.item,
      ...raw,
      eventId: this.data.eventId,
      registrationDate: raw.registrationDate ? new Date(raw.registrationDate) : this.data.item?.registrationDate
    };

    const request = this.isEdit ? this.service.update(value.id!, value) : this.service.add(value);

    request.then((result) => {
      if (result) {
        this.snackbar.success(this.itemType + (this.isEdit ? ' Updated' : ' Added'));
        this.dialogRef.close(true);
      } else {
        this.inProgress$.next(false);
        this.snackbar.error('Some Error Occured');
      }
    });
  }
}
