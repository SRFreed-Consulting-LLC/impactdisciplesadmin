import { Component, Inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { EventRegistrationModel } from '@impact-common/shared/models/domain/event-registration.model';
import { EventRegistrationService } from 'src/app/common/services/data/event-registration.service';
import { EMailService } from 'src/app/common/services/data/email.service';
import { SnackbarService } from '../../../shared/snackbar.service';
import { BaseEntityDialogComponent } from '../../../shared/base-entity-dialog.component';

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
export class EventAttendeeDialogComponent extends BaseEntityDialogComponent<EventRegistrationModel> {
  readonly itemType = 'Registered User';

  constructor(
    protected readonly dialogRef: MatDialogRef<EventAttendeeDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public readonly data: EventAttendeeDialogData,
    private fb: FormBuilder,
    protected readonly service: EventRegistrationService,
    private emailService: EMailService,
    protected readonly snackbar: SnackbarService
  ) {
    super();

    this.form = this.fb.group({
      firstName: [data.item?.firstName ?? '', Validators.required],
      lastName: [data.item?.lastName ?? '', Validators.required],
      email: [data.item?.email ?? '', Validators.required],
      registrationDate: [this.toInputValue(data.item?.registrationDate)],
      receipt: [data.item?.receipt ?? '', Validators.required]
    });
  }

  private toInputValue(date: unknown): string {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date as string | number);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }


  resendEmail(): void {
    if (!this.data.item?.receiptEmailId) {
      return;
    }
    this.emailService.getById(this.data.item.receiptEmailId).then((mail) => {
      delete mail.delivery;
      return mail;
    }).then((mail) => {
      this.emailService.update(mail.id, mail).then(() => {
        this.snackbar.success('Email Resent Successfully!');
      });
    });
  }

  // Uses getRawValue(), not form.value, because this form has disabled
  // controls whose values still have to be written. Also derives three
  // fields the form does not hold - see the comments on each.
  protected override buildValue(): EventRegistrationModel {
    const raw = this.form.getRawValue();
    return {
      ...this.data.item,
      ...raw,
      // Case-insensitive sort key - keep in step with the lastName edit
      // (see registerForEventHttp, which stamps the same field).
      lastNameLower: (raw.lastName ?? '').toLowerCase(),
      // Normalized for the same reason registerForEventHttp normalizes it:
      // this address is the join key a contact's activity feed matches on
      // exactly, so a staff-entered "Bob@Example.com" would leave the
      // registration invisible under the contact "bob@example.com".
      email: (raw.email ?? '').trim().toLowerCase(),
      eventId: this.data.eventId,
      // Registration Date isn't a required field - if left blank while
      // adding a brand-new attendee (no existing item to fall back to),
      // this used to come out `undefined`, and Firestore's addDoc()
      // rejects a document with an undefined field value outright.
      // Defaulting to "now" keeps this Firestore-required field always
      // defined, matching what a real self-service signup would get.
      registrationDate: raw.registrationDate ? new Date(raw.registrationDate) : (this.data.item?.registrationDate ?? new Date())
    };
  }
}
