import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject, Observable, of, tap } from 'rxjs';
import { Timestamp } from 'firebase/firestore';
import { EnumHelper } from 'src/app/common/utils/enum_helper';
import { CustomerModel } from 'src/app/common/models/domain/utils/customer.model';
import { CustomerNoteModel } from 'src/app/common/models/domain/utils/customer-note.model';
import { CustomerService } from 'src/app/common/services/data/customer.service';
import { PurchasesService } from 'src/app/common/services/data/purchases.service';
import { EventRegistrationService } from 'src/app/common/services/data/event-registration.service';
import { EventModel } from 'src/app/common/models/domain/event.model';
import { EventRegistrationModel } from 'src/app/common/models/domain/event-registration.model';
import { CheckoutForm } from 'src/app/common/models/utils/cart.model';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { AdminUser } from 'src/app/common/models/admin/admin-user.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { SnackbarService } from '../../shared/snackbar.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';

export interface CustomerDialogData {
  item: CustomerModel | null;
  // Loaded once by the list screen (shared across every customer dialog
  // open) rather than re-fetched per customer - only used to resolve the
  // Events Attended tab's eventId -> event name/date lookup.
  events: EventModel[];
}

@Component({
    selector: 'app-customer-dialog',
    templateUrl: './customer-dialog.component.html',
    styleUrls: ['./customer-dialog.component.scss'],
    standalone: false
})
export class CustomerDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;

  states: string[] = EnumHelper.getStateTypesAsArray();
  countries: string[] = EnumHelper.getCountryTypesAsArray();

  purchases$: Observable<CheckoutForm[]>;
  eventRegistrations$: Observable<EventRegistrationModel[]>;
  events: EventModel[];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation. Two independent flags
  // since the Purchases and Events Attended tabs are two independent
  // sub-tables backed by two independent streams.
  purchasesLoading$ = new BehaviorSubject<boolean>(true);
  registrationsLoading$ = new BehaviorSubject<boolean>(true);

  purchasesColumns = ['dateProcessed', 'processedStatus', 'receipt', 'couponCode', 'total', 'taxes', 'shipping', 'charged', 'refunded', 'actions'];
  registrationsColumns = ['startDate', 'eventId', 'email', 'receipt', 'registrationDate', 'actions'];

  notes: CustomerNoteModel[];
  user: AdminUser;

  private itemType = 'Customer';

  constructor(
    private dialogRef: MatDialogRef<CustomerDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: CustomerDialogData,
    private fb: FormBuilder,
    private service: CustomerService,
    private purchasesService: PurchasesService,
    private eventRegistrationService: EventRegistrationService,
    private authService: AdminAuthService,
    private snackbar: SnackbarService,
    private confirmService: ConfirmService
  ) {
    this.isEdit = !!data.item?.id;
    this.events = data.events;
    this.user = this.authService.getLoggedInUser() as AdminUser;
    this.notes = data.item?.notes ? [...data.item.notes] : [];

    this.form = this.fb.group({
      firstName: [data.item?.firstName ?? '', Validators.required],
      lastName: [data.item?.lastName ?? '', Validators.required],
      email: [{ value: data.item?.email ?? '', disabled: true }, Validators.required],
      phone: this.fb.group({
        countryCode: [data.item?.phone?.countryCode ?? ''],
        number: [data.item?.phone?.number ?? ''],
        type: [data.item?.phone?.type ?? null]
      }),
      shippingAddress: this.fb.group({
        address1: [data.item?.shippingAddress?.address1 ?? ''],
        address2: [data.item?.shippingAddress?.address2 ?? ''],
        city: [data.item?.shippingAddress?.city ?? ''],
        state: [data.item?.shippingAddress?.state ?? ''],
        zip: [data.item?.shippingAddress?.zip ?? ''],
        country: [data.item?.shippingAddress?.country ?? '']
      }),
      billingAddress: this.fb.group({
        address1: [data.item?.billingAddress?.address1 ?? ''],
        address2: [data.item?.billingAddress?.address2 ?? ''],
        city: [data.item?.billingAddress?.city ?? ''],
        state: [data.item?.billingAddress?.state ?? ''],
        zip: [data.item?.billingAddress?.zip ?? ''],
        country: [data.item?.billingAddress?.country ?? '']
      })
    });

    this.purchases$ = (data.item?.email ? this.purchasesService.streamAllByValue('email', data.item.email) : of([])).pipe(
      tap(() => this.purchasesLoading$.next(false))
    );
    this.eventRegistrations$ = (data.item?.email
      ? this.eventRegistrationService.streamAllByValue('email', data.item.email)
      : of([])
    ).pipe(tap(() => this.registrationsLoading$.next(false)));
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
    const value: CustomerModel = { ...this.data.item, ...this.form.getRawValue(), notes: this.notes };

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

  getEventName(eventId: string): string {
    return this.events.find((event) => event.id === eventId)?.eventName ?? '';
  }

  // dateFromTimestamp() (impactdisciplescommon) doesn't always return a
  // Date: it returns null when it can't parse the value, but its string
  // branch has its own bug (a regex checking for literal "dd/dd/dddd"
  // characters that can never match a real date string) which makes it
  // fall through to returning the RAW STRING unchanged instead of null or
  // a parsed Date. Calling .toLocaleDateString() unconditionally on either
  // of those throws mid-render, which blanks out the ENTIRE row (Angular
  // aborts that embedded view's change detection), not just the one date
  // cell - live-diagnosed via Playwright: a customer with real event
  // history rendered as a single fully-blank row plus dozens of console
  // errors. `date instanceof Date` guards against both cases without
  // touching the shared utility itself.
  getEventDate(eventId: string): string {
    const event = this.events.find((e) => e.id === eventId);
    const date = event ? dateFromTimestamp(event.startDate) : null;
    return date instanceof Date ? date.toLocaleDateString() : '';
  }

  getDate(timestamp: unknown): string {
    const date = dateFromTimestamp(timestamp);
    return date instanceof Date ? date.toLocaleDateString() : '';
  }

  addNote(): void {
    const note: CustomerNoteModel = {
      ...new CustomerNoteModel(),
      date: Timestamp.now(),
      addedBy: `${this.user.firstName} ${this.user.lastName}`,
      private: false,
      id: this.generateRandomId()
    };
    this.notes.push(note);
  }

  canSeeNote(note: CustomerNoteModel): boolean {
    return !note.private || note.addedBy === `${this.user.firstName} ${this.user.lastName}`;
  }

  deleteNote(index: number): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this note?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.notes.splice(index, 1);
        this.persistNotes();
      }
    });
  }

  saveNote(): void {
    this.persistNotes();
  }

  private persistNotes(): void {
    if (!this.data.item?.id) {
      return;
    }
    const value: CustomerModel = { ...this.data.item, notes: this.notes };
    this.service.update(this.data.item.id, value).then((item) => {
      if (item) {
        this.snackbar.success(this.itemType + ' Updated');
      }
    });
  }

  private generateRandomId(): string {
    return 'xxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
