import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, Observable, combineLatest, tap } from 'rxjs';
import { map } from 'rxjs/operators';
import { Timestamp } from 'firebase/firestore';
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

export type TimelineFilter = 'all' | 'purchase' | 'event' | 'note';

export interface TimelineEntry {
  type: 'purchase' | 'event' | 'note';
  date: Date | null;
  purchase?: CheckoutForm;
  registration?: EventRegistrationModel;
  note?: CustomerNoteModel;
}

// Full in-page/in-dialog edit view for a single customer - replaces the old
// CustomerDialogComponent's six-tab MatDialog (capped at 1200px/95vw, every
// tab independently capped at max-height:55vh to dodge a double-scrollbar
// bug in mat-dialog-content) with the merge of the "Stat Bar", "Split Pane"
// and "Timeline" concepts from the reviewed mockup gallery:
// https://claude.ai/code/artifact/f2b5eaed-beb2-4491-bab7-b9d8245858ea
// (same idea as purchase-details.component.ts's own redesign, and its own
// linked mockups, for Sale Details).
//
// Deliberately self-contained (owns its own form, header, and bottom
// save/cancel bar) rather than following PurchaseDetailsComponent's
// "dumb display, parent owns the form" split - this component has two
// hosts: CustomersComponent's in-place editor (no popup - see its own
// comment) AND CustomerDetailsDialogComponent, a thin MatDialog wrapper
// PurchaseDetailsComponent's "View Customer Record" opens so a jump from
// the Purchases screen doesn't lose that screen's own edit-in-progress
// state. Both hosts just supply selectedItem/events and listen for
// back/saved - none of the form/notes/pending-change logic is duplicated
// between them.
@Component({
    selector: 'app-customer-details',
    templateUrl: './customer-details.component.html',
    styleUrls: ['./customer-details.component.scss'],
    standalone: false
})
export class CustomerDetailsComponent implements OnInit {
  @Input() selectedItem: CustomerModel;
  @Input() events: EventModel[] = [];

  // Cancel (no save) and a successful Save both just mean "done with this
  // customer" to either host - CustomersComponent returns to its list mode
  // and reloads page 1 either way (notes/pending-change resolutions already
  // persisted immediately, same as the old dialog), and the dialog wrapper
  // closes either way. No separate "changed" flag needed any more since
  // there's no dialog-close return value to thread it through.
  @Output() back = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();

  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);

  purchases$: Observable<CheckoutForm[]>;
  eventRegistrations$: Observable<EventRegistrationModel[]>;
  timeline$: Observable<TimelineEntry[]>;
  stats$: Observable<{ spend: number; orders: number; eventsAttended: number }>;

  // House rule: loading spinner shown until first emission - two independent
  // flags since Purchases and Events Attended are two independent streams
  // feeding the one merged timeline.
  purchasesLoading$ = new BehaviorSubject<boolean>(true);
  registrationsLoading$ = new BehaviorSubject<boolean>(true);

  pendingChanges: PendingCustomerChange[] = [];
  notes: CustomerNoteModel[] = [];

  // Only pushed to on add/delete (a real shape change) - an in-place edit to
  // an existing note's text/private flag doesn't need timeline$ to re-run,
  // the template's ngModel bindings already read the same note object
  // timeline$'s last emission wrapped, live, on every change-detection pass.
  private notesSubject = new BehaviorSubject<CustomerNoteModel[]>([]);

  activeFilter: TimelineFilter = 'all';

  user: AdminUser;

  private itemType = 'Customer';

  constructor(
    private fb: FormBuilder,
    private service: CustomerService,
    private purchasesService: PurchasesService,
    private eventRegistrationService: EventRegistrationService,
    private authService: AdminAuthService,
    private snackbar: SnackbarService,
    private confirmService: ConfirmService,
    private dialog: MatDialog
  ) {}

  // Built from @Input()s in ngOnInit rather than the constructor - unlike
  // the old dialog's MAT_DIALOG_DATA (injected, available synchronously in
  // the constructor), Angular doesn't set @Input() values until after
  // construction.
  ngOnInit(): void {
    this.user = this.authService.getLoggedInUser() as AdminUser;
    this.notes = this.selectedItem.notes ? [...this.selectedItem.notes] : [];
    this.notesSubject.next(this.notes);
    this.pendingChanges = this.selectedItem.pendingChanges ? [...this.selectedItem.pendingChanges] : [];

    this.form = this.fb.group({
      firstName: [this.selectedItem.firstName ?? '', Validators.required],
      lastName: [this.selectedItem.lastName ?? '', Validators.required],
      email: [{ value: this.selectedItem.email ?? '', disabled: true }, Validators.required],
      phone: this.fb.group({
        countryCode: [this.selectedItem.phone?.countryCode ?? ''],
        number: [this.selectedItem.phone?.number ?? ''],
        type: [this.selectedItem.phone?.type ?? null]
      }),
      shippingAddress: this.fb.group({
        address1: [this.selectedItem.shippingAddress?.address1 ?? ''],
        address2: [this.selectedItem.shippingAddress?.address2 ?? ''],
        city: [this.selectedItem.shippingAddress?.city ?? ''],
        state: [this.selectedItem.shippingAddress?.state ?? ''],
        zip: [this.selectedItem.shippingAddress?.zip ?? ''],
        country: [this.selectedItem.shippingAddress?.country ?? '']
      }),
      billingAddress: this.fb.group({
        address1: [this.selectedItem.billingAddress?.address1 ?? ''],
        address2: [this.selectedItem.billingAddress?.address2 ?? ''],
        city: [this.selectedItem.billingAddress?.city ?? ''],
        state: [this.selectedItem.billingAddress?.state ?? ''],
        zip: [this.selectedItem.billingAddress?.zip ?? ''],
        country: [this.selectedItem.billingAddress?.country ?? '']
      })
    });

    this.purchases$ = this.purchasesService.streamAllByValue('email', this.selectedItem.email).pipe(
      tap(() => this.purchasesLoading$.next(false))
    );
    this.eventRegistrations$ = this.eventRegistrationService.streamAllByValue('email', this.selectedItem.email).pipe(
      tap(() => this.registrationsLoading$.next(false))
    );

    // Net spend (charged minus refunded) rather than raw `total` - a fully
    // refunded order shouldn't still count toward "lifetime spend". Neither
    // figure was computed anywhere before this screen existed.
    this.stats$ = combineLatest([this.purchases$, this.eventRegistrations$]).pipe(
      map(([purchases, registrations]) => ({
        spend: purchases.reduce((sum, p) => sum + (p.total ?? 0) - (p.refundAmount ?? 0), 0),
        orders: purchases.length,
        eventsAttended: registrations.length
      }))
    );

    this.timeline$ = combineLatest([this.purchases$, this.eventRegistrations$, this.notesSubject]).pipe(
      map(([purchases, registrations, notes]) => this.buildTimeline(purchases, registrations, notes))
    );
  }

  // ---- Timeline ----

  private buildTimeline(purchases: CheckoutForm[], registrations: EventRegistrationModel[], notes: CustomerNoteModel[]): TimelineEntry[] {
    const purchaseEntries: TimelineEntry[] = purchases.map((purchase) => ({
      type: 'purchase',
      date: this.toDate(purchase.dateProcessed),
      purchase
    }));

    // Same "Date" the old Events Attended table showed - the event's own
    // startDate, not the registration's own registrationDate (when someone
    // signed up, not when the event happened).
    const eventEntries: TimelineEntry[] = registrations.map((registration) => ({
      type: 'event',
      date: this.toDate(this.events.find((e) => e.id === registration.eventId)?.startDate),
      registration
    }));

    // A private note someone else added is filtered out here (same rule as
    // the old Notes tab's canSeeNote()) rather than in the template, so it
    // never appears in the merged feed at all.
    const noteEntries: TimelineEntry[] = notes
      .filter((note) => this.canSeeNote(note))
      .map((note) => ({ type: 'note', date: this.toDate(note.date), note }));

    return [...purchaseEntries, ...eventEntries, ...noteEntries].sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  }

  filteredTimeline(entries: TimelineEntry[]): TimelineEntry[] {
    return this.activeFilter === 'all' ? entries : entries.filter((e) => e.type === this.activeFilter);
  }

  emptyMessage(): string {
    switch (this.activeFilter) {
      case 'purchase': return 'No purchases found for this customer.';
      case 'event': return 'No event registrations found for this customer.';
      case 'note': return 'No notes found for this customer.';
      default: return 'No purchases, events, or notes found for this customer.';
    }
  }

  // dateFromTimestamp() (impactdisciplescommon) doesn't always return a
  // Date: it returns null when it can't parse the value, but its string
  // branch has its own bug (a regex checking for literal "dd/dd/dddd"
  // characters that can never match a real date string) which makes it
  // fall through to returning the RAW STRING unchanged instead of null or a
  // parsed Date. `instanceof Date` guards against both cases without
  // touching the shared utility itself - same fix the old dialog's
  // getEventDate()/getDate() applied.
  private toDate(value: unknown): Date | null {
    const date = dateFromTimestamp(value);
    return date instanceof Date ? date : null;
  }

  getEventName(eventId: string): string {
    return this.events.find((event) => event.id === eventId)?.eventName ?? '';
  }

  // Same label lookup as purchases.component.ts's own
  // getFulfillmentStatusLabel() - this feed shows the same status this
  // customer's purchases carry on the main Purchases screen.
  getFulfillmentStatusLabel(status: FulfillmentStatus | undefined): string {
    return FULFILLMENT_STEPS.find((s) => s.status === status)?.statusLabel ?? 'Unknown';
  }

  // ---- Save / cancel ----

  onCancel(): void {
    this.back.emit();
  }

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.inProgress$.next(true);
    const value: CustomerModel = { ...this.selectedItem, ...this.form.getRawValue(), notes: this.notes, pendingChanges: this.pendingChanges };

    this.service.update(value.id!, value).then((result) => {
      if (result) {
        this.snackbar.success(this.itemType + ' Updated');
        this.saved.emit();
      } else {
        this.inProgress$.next(false);
        this.snackbar.error('Some Error Occured');
      }
    });
  }

  // ---- Pending Updates ----
  // Accept applies the purchase's proposed value straight into the form (so
  // it's visible immediately) and persists right away rather than waiting
  // for the main SAVE button - same reasoning as addNote()/deleteNote()
  // persisting immediately. Reject just drops the entry and keeps whatever's
  // already on file.
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

    const value: CustomerModel = { ...this.selectedItem, ...this.form.getRawValue(), notes: this.notes, pendingChanges: this.pendingChanges };
    this.selectedItem = value;
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

  // ---- Notes ----
  // Opens a small popup to compose the note text (and whether it's private)
  // up front, then pushes the finished note and persists immediately -
  // existing notes still edit in place, right in the timeline.
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
      this.notesSubject.next(this.notes);
      this.persistNotes();
    });
  }

  canSeeNote(note: CustomerNoteModel): boolean {
    return !note.private || note.addedBy === `${this.user.firstName} ${this.user.lastName}`;
  }

  deleteNote(note: CustomerNoteModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this note?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.notes = this.notes.filter((n) => n !== note);
        this.notesSubject.next(this.notes);
        this.persistNotes();
      }
    });
  }

  saveNote(): void {
    this.persistNotes();
  }

  private persistNotes(): void {
    if (!this.selectedItem?.id) {
      return;
    }
    const value: CustomerModel = { ...this.selectedItem, notes: this.notes };
    this.selectedItem = value;
    this.service.update(this.selectedItem.id, value).then((item) => {
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
