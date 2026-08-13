import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { Timestamp } from 'firebase/firestore';
import { EnumHelper } from 'src/app/common/utils/enum_helper';
import { CustomerModel, PendingCustomerChange } from 'src/app/common/models/domain/utils/customer.model';
import { CustomerNoteModel } from 'src/app/common/models/domain/utils/customer-note.model';
import { CustomerService } from 'src/app/common/services/data/customer.service';
import { PurchasesService } from 'src/app/common/services/data/purchases.service';
import { EventRegistrationService } from 'src/app/common/services/data/event-registration.service';
import { EventModel } from 'src/app/common/models/domain/event.model';
import { EventRegistrationModel } from 'src/app/common/models/domain/event-registration.model';
import { CheckoutForm, FulfillmentStatus } from 'src/app/common/models/utils/cart.model';
import { Address } from 'src/app/common/models/domain/utils/address.model';
import { Phone } from 'src/app/common/models/domain/utils/phone.model';
import { FULFILLMENT_STEPS } from '../fulfillment/fulfillment-steps';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { AdminUser } from 'src/app/common/models/admin/admin-user.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { SnackbarService } from '../../shared/snackbar.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { AddCustomerNoteDialogComponent } from './add-customer-note-dialog.component';

export interface CustomerDialogData {
  // Always a real, already-persisted customer now - there's no "New
  // Customer" flow any more (see customers.component.ts's own comment), so
  // this dialog is edit + review only.
  item: CustomerModel;
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

  states: string[] = EnumHelper.getStateTypesAsArray();
  countries: string[] = EnumHelper.getCountryTypesAsArray();

  purchases$: Observable<CheckoutForm[]>;
  eventRegistrations$: Observable<EventRegistrationModel[]>;
  events: EventModel[];

  // See PendingCustomerChange's own comment (customer.model.ts) - a
  // purchase under this customer's email disagreed with what's on file.
  // Local copy (not just read off this.data.item) so resolving one updates
  // the tab immediately without waiting on a round-trip.
  pendingChanges: PendingCustomerChange[];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation. Two independent flags
  // since the Purchases and Events Attended tabs are two independent
  // sub-tables backed by two independent streams.
  purchasesLoading$ = new BehaviorSubject<boolean>(true);
  registrationsLoading$ = new BehaviorSubject<boolean>(true);

  purchasesColumns = ['dateProcessed', 'fulfillmentStatus', 'receipt', 'couponCode', 'total', 'taxes', 'shipping', 'charged', 'refunded', 'actions'];
  registrationsColumns = ['startDate', 'eventId', 'email', 'receipt', 'registrationDate', 'actions'];

  notes: CustomerNoteModel[];
  user: AdminUser;

  // Resolving a pending change (or adding/editing a note) saves immediately
  // rather than waiting for the main SAVE button - so closing via CANCEL/the
  // X button afterward must still tell the list screen something changed,
  // not just report false because the main form itself was never submitted.
  // See onCancel()/resolvePendingChange()/persistNotes().
  private changed = false;

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
    private confirmService: ConfirmService,
    private dialog: MatDialog
  ) {
    this.events = data.events;
    this.user = this.authService.getLoggedInUser() as AdminUser;
    this.notes = data.item.notes ? [...data.item.notes] : [];
    this.pendingChanges = data.item.pendingChanges ? [...data.item.pendingChanges] : [];

    this.form = this.fb.group({
      firstName: [data.item.firstName ?? '', Validators.required],
      lastName: [data.item.lastName ?? '', Validators.required],
      email: [{ value: data.item.email ?? '', disabled: true }, Validators.required],
      phone: this.fb.group({
        countryCode: [data.item.phone?.countryCode ?? ''],
        number: [data.item.phone?.number ?? ''],
        type: [data.item.phone?.type ?? null]
      }),
      shippingAddress: this.fb.group({
        address1: [data.item.shippingAddress?.address1 ?? ''],
        address2: [data.item.shippingAddress?.address2 ?? ''],
        city: [data.item.shippingAddress?.city ?? ''],
        state: [data.item.shippingAddress?.state ?? ''],
        zip: [data.item.shippingAddress?.zip ?? ''],
        country: [data.item.shippingAddress?.country ?? '']
      }),
      billingAddress: this.fb.group({
        address1: [data.item.billingAddress?.address1 ?? ''],
        address2: [data.item.billingAddress?.address2 ?? ''],
        city: [data.item.billingAddress?.city ?? ''],
        state: [data.item.billingAddress?.state ?? ''],
        zip: [data.item.billingAddress?.zip ?? ''],
        country: [data.item.billingAddress?.country ?? '']
      })
    });

    this.purchases$ = this.purchasesService.streamAllByValue('email', data.item.email).pipe(
      tap(() => this.purchasesLoading$.next(false))
    );
    this.eventRegistrations$ = this.eventRegistrationService.streamAllByValue('email', data.item.email).pipe(
      tap(() => this.registrationsLoading$.next(false))
    );
  }

  onCancel(): void {
    this.dialogRef.close(this.changed);
  }

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.inProgress$.next(true);
    const value: CustomerModel = { ...this.data.item, ...this.form.getRawValue(), notes: this.notes, pendingChanges: this.pendingChanges };

    this.service.update(value.id!, value).then((result) => {
      if (result) {
        this.snackbar.success(this.itemType + ' Updated');
        this.dialogRef.close(true);
      } else {
        this.inProgress$.next(false);
        this.snackbar.error('Some Error Occured');
      }
    });
  }

  // ---- Pending Updates tab ----
  // Accept applies the purchase's proposed value straight into the form
  // (so it's visible on the Info/Addresses tabs immediately) and persists
  // right away rather than waiting for the main SAVE button - same reasoning
  // as CustomerNoteModel's addNote()/deleteNote() persisting immediately.
  // Reject just drops the entry and keeps whatever's already on file.
  resolvePendingChange(change: PendingCustomerChange, accept: boolean): void {
    if (accept) {
      switch (change.field) {
        case 'firstName':
        case 'lastName':
          this.form.get(change.field)?.setValue(change.proposedValue);
          break;
        case 'phone':
          this.form.get('phone')?.patchValue(change.proposedValue as Phone);
          break;
        case 'shippingAddress':
        case 'billingAddress':
          this.form.get(change.field)?.patchValue(change.proposedValue as Address);
          break;
      }
    }

    this.pendingChanges = this.pendingChanges.filter((c) => c !== change);

    const value: CustomerModel = { ...this.data.item, ...this.form.getRawValue(), notes: this.notes, pendingChanges: this.pendingChanges };
    this.data.item = value;
    this.changed = true;
    this.service.update(value.id!, value).then(() => {
      this.snackbar.success(accept ? 'Update applied' : 'Update dismissed');
    });
  }

  pendingFieldLabel(field: PendingCustomerChange['field']): string {
    switch (field) {
      case 'firstName': return 'First Name';
      case 'lastName': return 'Last Name';
      case 'phone': return 'Phone';
      case 'shippingAddress': return 'Shipping Address';
      case 'billingAddress': return 'Billing Address';
    }
  }

  formatPendingValue(field: PendingCustomerChange['field'], value: unknown): string {
    if (value == null) {
      return '—';
    }
    if (field === 'shippingAddress' || field === 'billingAddress') {
      const a = value as Address;
      return [a.address1, a.address2, [a.city, a.state, a.zip].filter(Boolean).join(', '), a.country].filter(Boolean).join(', ') || '—';
    }
    if (field === 'phone') {
      const p = value as Phone;
      return p.number ? [p.countryCode, p.number].filter(Boolean).join(' ') : '—';
    }
    return String(value) || '—';
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

  // Same label lookup as purchases.component.ts's own
  // getFulfillmentStatusLabel() - this tab shows the same status this
  // customer's purchases carry on the main Purchases screen.
  getFulfillmentStatusLabel(status: FulfillmentStatus | undefined): string {
    return FULFILLMENT_STEPS.find((s) => s.status === status)?.statusLabel ?? 'Unknown';
  }

  // Opens a small popup to compose the note text (and whether it's
  // private) up front, then pushes the finished note and persists
  // immediately - replaces the old flow of pushing a blank note into the
  // list and relying on the inline textarea + a separate "SAVE" click.
  // Existing notes still edit in place below; this only changes how a new
  // one gets created.
  addNote(): void {
    const dialogRef = this.dialog.open(AddCustomerNoteDialogComponent, { width: '480px' });
    dialogRef.afterClosed().subscribe((result) => {
      if (!result) {
        return;
      }
      const note: CustomerNoteModel = {
        ...new CustomerNoteModel(),
        date: Timestamp.now(),
        addedBy: `${this.user.firstName} ${this.user.lastName}`,
        private: result.private,
        note: result.note,
        id: this.generateRandomId()
      };
      this.notes = [...this.notes, note];
      this.persistNotes();
    });
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
    this.changed = true;
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
