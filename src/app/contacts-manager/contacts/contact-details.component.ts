import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { AbstractControl, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, Observable, combineLatest, tap } from 'rxjs';
import { map } from 'rxjs/operators';
import { Timestamp } from 'firebase/firestore';
import { ContactModel, PendingContactChange, SubscriptionType, subscriptionFieldsForType } from 'src/app/common/models/domain/utils/contact.model';
import { ContactNoteModel } from 'src/app/common/models/domain/utils/contact-note.model';
import { ContactService } from 'src/app/common/services/data/contact.service';
import { PurchasesService } from 'src/app/common/services/data/purchases.service';
import { EventRegistrationService } from 'src/app/common/services/data/event-registration.service';
import { TagRuleService } from 'src/app/common/services/data/tag-rule.service';
import { TagApplicationService } from 'src/app/common/services/data/tag-application.service';
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
import { AddContactNoteDialogComponent } from './add-contact-note-dialog.component';

export type TimelineFilter = 'all' | 'purchase' | 'event' | 'note';

export interface TimelineEntry {
  type: 'purchase' | 'event' | 'note';
  date: Date | null;
  purchase?: CheckoutForm;
  registration?: EventRegistrationModel;
  note?: ContactNoteModel;
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
// hosts: ContactsComponent's in-place editor (no popup - see its own
// comment) AND ContactDetailsDialogComponent, a thin MatDialog wrapper
// PurchaseDetailsComponent's "View Contact Record" opens so a jump from
// the Purchases screen doesn't lose that screen's own edit-in-progress
// state. Both hosts just supply selectedItem/events and listen for
// back/saved - none of the form/notes/pending-change logic is duplicated
// between them.
@Component({
    selector: 'app-contact-details',
    templateUrl: './contact-details.component.html',
    styleUrls: ['./contact-details.component.scss'],
    standalone: false
})
export class ContactDetailsComponent implements OnInit {
  @Input() selectedItem: ContactModel;
  @Input() events: EventModel[] = [];

  // Cancel (no save) and a successful Save both just mean "done with this
  // customer" to either host - ContactsComponent returns to its list mode
  // and reloads page 1 either way (notes/pending-change resolutions already
  // persisted immediately, same as the old dialog), and the dialog wrapper
  // closes either way. No separate "changed" flag needed any more since
  // there's no dialog-close return value to thread it through.
  @Output() back = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();

  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);

  // Shipping always opens expanded on load; Billing starts collapsed (it's
  // usually a duplicate) but pops open the moment the "same as shipping"
  // box gets unchecked - see onSameAsShippingToggle() - so the admin isn't
  // left needing an extra click to see what they just asked to edit.
  shippingExpanded = true;
  billingExpanded = false;

  purchases$: Observable<CheckoutForm[]>;
  eventRegistrations$: Observable<EventRegistrationModel[]>;
  timeline$: Observable<TimelineEntry[]>;
  stats$: Observable<{ spend: number; orders: number; eventsAttended: number }>;

  // House rule: loading spinner shown until first emission - two independent
  // flags since Purchases and Events Attended are two independent streams
  // feeding the one merged timeline.
  purchasesLoading$ = new BehaviorSubject<boolean>(true);
  registrationsLoading$ = new BehaviorSubject<boolean>(true);

  pendingChanges: PendingContactChange[] = [];
  notes: ContactNoteModel[] = [];

  // Customer tags - working copy edited by the chips UI, persisted on Save
  // (buildUpdatedCustomer folds it in). initialTags is what was on the doc
  // when this editor opened, so the save path can diff and mirror the
  // manual adds/removes into tag_applications (see TagApplicationService -
  // manual tags participate in auto-campaigns too).
  tags: string[] = [];
  newTag = '';
  private initialTags: string[] = [];
  // Distinct tag names across all rules - one-click add suggestions.
  private ruleTags: string[] = [];

  // Only pushed to on add/delete (a real shape change) - an in-place edit to
  // an existing note's text/private flag doesn't need timeline$ to re-run,
  // the template's ngModel bindings already read the same note object
  // timeline$'s last emission wrapped, live, on every change-detection pass.
  private notesSubject = new BehaviorSubject<ContactNoteModel[]>([]);

  activeFilter: TimelineFilter = 'all';

  user: AdminUser;

  private itemType = 'Contact';

  constructor(
    private fb: FormBuilder,
    private service: ContactService,
    private purchasesService: PurchasesService,
    private eventRegistrationService: EventRegistrationService,
    private tagRuleService: TagRuleService,
    private tagApplicationService: TagApplicationService,
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

    this.tags = [...(this.selectedItem.tags ?? [])];
    this.initialTags = [...this.tags];
    this.tagRuleService.getAll().then((rules) => {
      this.ruleTags = Array.from(new Set(rules.map((rule) => rule.tag?.trim()).filter(Boolean))) as string[];
    });

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
      }),
      isBillingSameAsShipping: [this.defaultIsBillingSameAsShipping()],
      // See contact.model.ts's own comment - a subscriber IS a customer
      // now, these 2 flags are the same data the Subscribers screen reads/
      // writes, just editable here too.
      subscribedToNewsletter: [this.selectedItem.subscribedToNewsletter ?? false],
      subscribedToPrayerTeam: [this.selectedItem.subscribedToPrayerTeam ?? false]
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

  private buildTimeline(purchases: CheckoutForm[], registrations: EventRegistrationModel[], notes: ContactNoteModel[]): TimelineEntry[] {
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
      case 'purchase': return 'No purchases found for this contact.';
      case 'event': return 'No event registrations found for this contact.';
      case 'note': return 'No notes found for this contact.';
      default: return 'No purchases, events, or notes found for this contact.';
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

  // ---- Addresses ----

  // Collapsed-panel preview line - "123 Main St, Atlanta, GA" or a plain
  // placeholder when nothing's on file yet, so a collapsed section isn't
  // just a blank row with no way to tell whether it's actually empty.
  addressSummary(group: AbstractControl | null): string {
    const value = group?.value as Address | undefined;
    if (!value?.address1) {
      return 'No address on file';
    }
    return [value.address1, [value.city, value.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  }

  get isBillingSameAsShipping(): boolean {
    return !!this.form?.get('isBillingSameAsShipping')?.value;
  }

  // isBillingSameAsShipping is a new field - essentially every existing
  // customer record predates it (undefined, not false). Default to
  // "assume same" (the common case) for those UNLESS this record already
  // has a real, distinct billing address on file - a UI default silently
  // overwriting genuine historical data the first time someone opens and
  // saves an existing customer, without ever touching this checkbox, would
  // be a real (if quiet) data-loss bug. A record that explicitly has this
  // field set (true or false) always honors that instead.
  private defaultIsBillingSameAsShipping(): boolean {
    if (this.selectedItem.isBillingSameAsShipping != null) {
      return this.selectedItem.isBillingSameAsShipping;
    }
    return !this.hasDistinctBillingAddress();
  }

  private hasDistinctBillingAddress(): boolean {
    const billing = this.selectedItem.billingAddress;
    if (!billing?.address1) {
      return false;
    }
    const shipping = this.selectedItem.shippingAddress;
    const fields: (keyof Address)[] = ['address1', 'address2', 'city', 'state', 'zip', 'country'];
    return fields.some((f) => (billing[f] ?? '') !== (shipping?.[f] ?? ''));
  }

  // Copies whatever's in Shipping into Billing's form fields right away -
  // not required for correctness (buildUpdatedCustomer() re-copies at Save
  // time regardless, in case Shipping is edited afterward while this stays
  // checked), just so unchecking the box later starts from a populated,
  // editable Billing section instead of a blank one. Unchecking also pops
  // Billing open (see billingExpanded's own comment) - checking it back
  // doesn't need to touch billingExpanded, the section just hides again.
  onSameAsShippingToggle(checked: boolean): void {
    if (checked) {
      this.form.get('billingAddress')?.patchValue(this.form.get('shippingAddress')?.value);
    } else {
      this.billingExpanded = true;
    }
  }

  // ---- Subscriptions ----
  // Read/write the same 2 flags the Subscribers screen and the public
  // site's subscribe_to_email_list/unsubscribe_from_email_list endpoints
  // use (see contact.model.ts's own comment) - this is just another place
  // to see/flip them, not a separate mechanism.

  subscriptionLabel(type: SubscriptionType): string {
    return type === 'prayer' ? 'Prayer Team' : 'Newsletter';
  }

  subscriptionDateLabel(type: SubscriptionType): string {
    const { dateField } = subscriptionFieldsForType(type);
    const date = dateFromTimestamp(this.selectedItem[dateField]);
    return date instanceof Date ? `Subscribed ${date.toLocaleDateString()}` : '';
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
    const value = this.buildUpdatedCustomer();

    this.service.update(value.id!, value).then((result) => {
      if (result) {
        this.syncTagApplications();
        this.snackbar.success(this.itemType + ' Updated');
        this.saved.emit();
      } else {
        this.inProgress$.next(false);
        this.snackbar.error('Some Error Occured');
      }
    });
  }

  // Shared by onSave() and resolvePendingChange() - both persist the WHOLE
  // form (see resolvePendingChange's own comment on why), so both need the
  // same subscription-date-stamping/same-as-shipping rules applied, not
  // just the main Save button.
  private buildUpdatedCustomer(): ContactModel {
    const raw = this.form.getRawValue();
    // Re-copy at Save time (not just on the checkbox's own toggle - see
    // onSameAsShippingToggle()) so Billing always reflects whatever's
    // currently in Shipping, even if Shipping was edited after the box was
    // already checked.
    if (raw.isBillingSameAsShipping) {
      raw.billingAddress = { ...raw.shippingAddress };
    }
    const value: ContactModel = { ...this.selectedItem, ...raw, notes: this.notes, pendingChanges: this.pendingChanges, tags: this.tags };
    this.stampSubscriptionDates(value);
    return value;
  }

  // ---- Tags ----

  tagSuggestions(): string[] {
    return this.ruleTags.filter((tag) => !this.tags.includes(tag));
  }

  addTag(tag?: string): void {
    const value = (tag ?? this.newTag).trim();
    // No '/' - the tag becomes part of a tag_applications doc id (same
    // validation as the Tag Rules screen).
    if (!value || value.includes('/') || this.tags.includes(value)) {
      if (value.includes('/')) {
        this.snackbar.error("Tags can't contain \"/\".");
      }
      return;
    }
    this.tags = [...this.tags, value];
    this.newTag = '';
  }

  removeTag(tag: string): void {
    this.tags = this.tags.filter((candidate) => candidate !== tag);
  }

  // Mirrors manual chip adds/removes into tag_applications after a
  // successful save, so manually-tagged customers participate in
  // auto-campaigns (and removals stop qualifying them). Fire-and-forget
  // with logging - a mirror failure shouldn't fail the customer save that
  // already happened.
  private syncTagApplications(): void {
    const email = (this.selectedItem.email ?? '').trim().toLowerCase();
    if (!email) {
      return;
    }
    const added = this.tags.filter((tag) => !this.initialTags.includes(tag));
    const removed = this.initialTags.filter((tag) => !this.tags.includes(tag));
    for (const tag of added) {
      this.tagApplicationService.recordManualApplication(email, tag)
        .catch((err) => console.error('tag_applications create failed', tag, err));
    }
    for (const tag of removed) {
      this.tagApplicationService.removeApplication(email, tag)
        .catch((err) => console.error('tag_applications delete failed', tag, err));
    }
    this.initialTags = [...this.tags];
  }

  // Checking a subscription box writes the flag exactly like the
  // Subscribers screen's own Add/Edit (see subscriptionFieldsForType) -
  // stamp a fresh *SubscribedDate only on a false -> true transition;
  // unchecking leaves the date alone ("last subscribed", not "currently
  // subscribed since" - same rule everywhere else this flag pair is
  // written, see contact.model.ts's own comment).
  private stampSubscriptionDates(value: ContactModel): void {
    (['newsletter', 'prayer'] as SubscriptionType[]).forEach((type) => {
      const { flagField, dateField } = subscriptionFieldsForType(type);
      const wasSubscribed = !!this.selectedItem[flagField];
      const isSubscribed = !!value[flagField];
      if (isSubscribed && !wasSubscribed) {
        value[dateField] = Timestamp.now();
      }
    });
  }

  // ---- Pending Updates ----
  // Accept applies the purchase's proposed value straight into the form (so
  // it's visible immediately) and persists right away rather than waiting
  // for the main SAVE button - same reasoning as addNote()/deleteNote()
  // persisting immediately. Reject just drops the entry and keeps whatever's
  // already on file.
  resolvePendingChange(change: PendingContactChange, accept: boolean): void {
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

    const value = this.buildUpdatedCustomer();
    this.selectedItem = value;
    this.service.update(value.id!, value).then(() => {
      this.snackbar.success(accept ? 'Update applied' : 'Update dismissed');
    });
  }

  pendingFieldLabel(field: PendingContactChange['field']): string {
    switch (field) {
      case 'firstName': return 'First Name';
      case 'lastName': return 'Last Name';
      case 'phone': return 'Phone';
      case 'shippingAddress': return 'Shipping Address';
      case 'billingAddress': return 'Billing Address';
    }
  }

  formatPendingValue(field: PendingContactChange['field'], value: unknown): string {
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
    const dialogRef = this.dialog.open(AddContactNoteDialogComponent, { width: '480px' });
    dialogRef.afterClosed().subscribe((result) => {
      if (!result) {
        return;
      }
      const note: ContactNoteModel = {
        ...new ContactNoteModel(),
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

  canSeeNote(note: ContactNoteModel): boolean {
    return !note.private || note.addedBy === `${this.user.firstName} ${this.user.lastName}`;
  }

  deleteNote(note: ContactNoteModel): void {
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
    const value: ContactModel = { ...this.selectedItem, notes: this.notes };
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
