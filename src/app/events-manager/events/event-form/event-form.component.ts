import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { EventModel, EventVenue } from '@impact-common/shared/models/domain/event.model';
import { OrganizationModel } from '@impact-common/shared/models/domain/organization.model';
import { LocationModel } from '@impact-common/shared/models/domain/location.model';
import { ImageModel } from '@impact-common/shared/models/utils/image.model';
import { EventService } from 'src/app/common/services/data/event.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { EmailTemplateEditorService } from 'src/app/common/services/email-template-editor.service';
import { SnackbarService } from '../../../shared/snackbar.service';
import { SummitPreviewData } from '../summit-preview/summit-preview.component';
import { VenueRoomsDialogComponent } from '../venue-rooms-dialog.component';
import { toTimeValue } from '../event-time.util';

// The event editor - the densest form in the app, extracted from
// EventsComponent 2026-08-21 (bucket A item #5, option 2). That component
// was 683 lines of TS + 440 of template, and 374 of those template lines
// were THIS; what was left there was a list screen and a mode switch.
//
// Hosted by EventsComponent's `mode === 'edit'`, so it is created and
// destroyed with the editor - which is why ngOnInit alone is enough to set
// up, with no ngOnChanges/reset dance.
//
// IMPORTANT - `item` is a live, shared object, not a snapshot. The parent
// hands down ITS OWN working copy (EventsComponent.editingItem, already
// cloned from the list row so an abandoned edit cannot corrupt the grid),
// and the three tab children below - app-event-application, app-event-agenda,
// app-event-attendees - all receive that same reference and MUTATE IT IN
// PLACE rather than emitting changes back. onSave() then reads those
// mutations straight off it. Do not clone `item` here, and do not rebuild
// the save payload purely from form values: either would silently discard
// everything those tabs edit. Pinned by the "editingItem identity contract"
// specs (originally in events.component.spec.ts, moved here with the code).
//
// The Info tab's own fields live in `form` instead and are merged back on
// top of `item` at save time - the two field sets never overlap.
@Component({
    selector: 'app-event-form',
    templateUrl: './event-form.component.html',
    styleUrls: ['./event-form.component.scss'],
    standalone: false
})
export class EventFormComponent implements OnInit {
  /** The working copy being edited. See the IN PLACE note above. */
  @Input() item!: EventModel;
  @Input() summitMode = false;
  @Input() isEdit = false;
  /** Passed down rather than re-derived: EventsComponent.screenKey is the
   *  one place the summit-vs-events permission split is encoded, and every
   *  canView/canAdd/canEdit call in this class and its template routes
   *  through it. */
  @Input() screenKey = '';
  /** Which section to open on. A tab KEY, not an index - the real index
   *  depends on which tabs this admin can see (see tabIndexFor). */
  @Input() initialTabKey = 'info';
  @Input() organizations: OrganizationModel[] = [];
  @Input() locations: LocationModel[] = [];
  @Input() emailTemplates: string[] = [];

  // Editing the registration email from HERE, rather than sending the admin
  // to Tools Manager > System Templates to find it by name in a flat list.
  // The template is bound to this event by NAME (the `emailTemplate`
  // control below holds that name), which is also how the sender resolves
  // it - so a rename made on the templates screen looks harmless there and
  // silently detaches it from every event pointing at the old name.

  get canEditEmailTemplate(): boolean {
    return !!this.form.get('emailTemplate')?.value && this.templateEditor.canEdit();
  }

  editEmailTemplate(): void {
    const name = this.form.get('emailTemplate')?.value as string | null;
    if (name) {
      void this.templateEditor.openByName(name, { from: 'event', id: this.item?.id });
    }
  }
  /** Event ids with at least one unseen registration - drives the Attendees
   *  tab badge. Owned by the parent, which keeps one standing query for the
   *  whole screen (it also feeds the list's "New" column) rather than a
   *  second listener per editor open. */
  @Input() newAttendeeEventIds = new Set<string>();

  /** The saved doc as the service returned it - the parent decides where to
   *  go next (back to Mission Control, or the list). */
  @Output() saved = new EventEmitter<EventModel>();
  @Output() cancelled = new EventEmitter<void>();

  itemType = 'Event';

  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isImageUploaderVisible$ = new BehaviorSubject<boolean>(false);

  // Backs app-image-uploader's [card]/[field] inputs directly - see
  // home-page-image-dialog.component.ts (content-manager) for the established
  // explanation of this pattern.
  card: { imageUrl?: ImageModel } = {};

  // Which tab the mat-tab-group has open. Tab *ngIf visibility is
  // permission-gated, so the same tab key can sit at a different index per
  // admin - tabIndexFor() re-derives the real index from the same canView()
  // checks the template itself uses, rather than hardcoding a position.
  selectedTabIndex = 0;
  // No 'attendees' - on a summit that's the full-page report off the list
  // row (see EventsComponent's `mode`), not an edit tab.
  private readonly tabOrderSummit = ['info', 'application', 'agenda'];
  // Regular events only ever show Details (still keyed 'info' for
  // permission/deep-link continuity - see nav-config.ts) and Attendees -
  // Application/Agenda/Break Outs don't exist on this screen at all.
  private readonly tabOrderRegular = ['info', 'attendees'];

  constructor(
    private service: EventService,
    public permissionService: PermissionService,
    private fb: FormBuilder,
    private dialog: MatDialog,
    private snackbar: SnackbarService
    , private templateEditor: EmailTemplateEditorService
  ) {}

  ngOnInit(): void {
    this.card = { imageUrl: this.item.imageUrl };
    this.buildForm(this.item);
    this.selectedTabIndex = this.tabIndexFor(this.initialTabKey);
  }

  // The hub-card label for the section the summit editor is sitting on -
  // doubles as the editor's header title so the card -> editor hand-off
  // reads as one surface.
  summitSectionLabel(): string {
    const labels: Record<string, string> = {
      info: 'Info & Pricing',
      application: 'Attendee App Content',
      agenda: 'Agenda Builder',
    };
    const visible = this.tabOrderSummit.filter((key) => this.permissionService.canView(`${this.screenKey}.${key}`));
    return labels[visible[this.selectedTabIndex] ?? 'info'] ?? 'Info & Pricing';
  }

  private tabIndexFor(tabKey: string): number {
    const tabOrder = this.summitMode ? this.tabOrderSummit : this.tabOrderRegular;
    const visible = tabOrder.filter((key) => this.permissionService.canView(`${this.screenKey}.${key}`));
    const index = visible.indexOf(tabKey);
    return index >= 0 ? index : 0;
  }

  // ---- Info tab preview card ----
  // Reads the *live form value*, not a saved EventModel - the preview
  // updates as the admin types, before Save. Angular re-evaluates this each
  // change-detection cycle from the template, same as the existing
  // `card.imageUrl?.name` reads already do - no manual valueChanges
  // subscription needed.
  previewLocationName(): string {
    if (!this.form) return '';
    return this.resolveVenue(this.form.getRawValue())?.name ?? '';
  }

  // Feeds the summit Info tab's full public-page preview (app-summit-
  // preview) from the live form values - same pattern the wizard uses.
  summitPreviewData(): SummitPreviewData {
    const raw = this.form?.getRawValue() ?? {};
    return {
      eventName: raw.eventName,
      startDate: raw.startDate,
      endDate: raw.endDate,
      checkIn: raw.checkIn,
      description: raw.description,
      videoId: raw.videoId,
      imageUrl: this.card.imageUrl ?? null,
      venue: this.resolveVenue(raw),
      costInDollars: raw.costInDollars,
      // App-experience content + schedule for the rail's APP view. The
      // Application/Agenda/FAQ child components mutate `item` IN PLACE
      // pre-save, so reading it here keeps the preview live across every
      // section, not just the one being edited.
      diningOptions: this.item?.diningOptions ?? null,
      checkinInstructions: this.item?.checkinInstructions ?? null,
      whatsNext: this.item?.whatsNext ?? null,
      faqList: this.item?.faqList ?? null,
      agendaItems: this.item?.agendaItems ?? null
    };
  }

  // ---- Events (regular) screen: attendance-first pill row ----
  // Three pills (In-Person / Online / Both) replace the Summit/Online
  // checkboxes on the regular-event Details tab - they map onto the exact
  // same isOnline/isKajabiCourse controls, no schema change:
  //   In-Person -> isOnline: false, isKajabiCourse: false
  //   Online    -> isOnline: true,  isKajabiCourse: true  (Online is
  //                inherently Kajabi-hosted, there's no other delivery
  //                mechanism for it in this app)
  //   Both      -> isOnline: false, isKajabiCourse: true  (in-person with
  //                an optional Kajabi add-on)
  // updateConditionalValidators() already toggles required-ness purely off
  // isOnline, so Location/Check-in stay required for Both (still in-person)
  // and the Kajabi URLs stay optional for it, with no changes to that method.
  regularAttendanceType(): 'inperson' | 'online' | 'both' {
    if (this.form?.get('isOnline')?.value) return 'online';
    if (this.form?.get('isKajabiCourse')?.value) return 'both';
    return 'inperson';
  }

  setRegularAttendanceType(type: 'inperson' | 'online' | 'both'): void {
    this.form.get('isOnline')?.setValue(type === 'online');
    this.form.get('isKajabiCourse')?.setValue(type === 'online' || type === 'both');
  }

  // ---- Venue: organization -> optional location ----
  // A regular event happens AT an organization; the org's child locations
  // (if any) narrow it to a specific site, otherwise the org's own mailing
  // address is the venue. Summits skip both - they always happen at the one
  // pinned isSummitVenue location (see location.model.ts).

  // The chosen org's child locations - drives whether the Location select
  // renders at all.
  orgLocations(): LocationModel[] {
    const orgId = this.form?.get('organization')?.value;
    if (!orgId) return [];
    return this.locations.filter((l) => l.organization === orgId);
  }

  summitVenue(): LocationModel | undefined {
    return this.locations.find((l) => l.isSummitVenue);
  }

  // ---- Summit Venue Rooms ----
  // The pinned venue's rooms (embedded on its `locations` doc) are edited
  // HERE and nowhere else since the standalone Locations screen retired -
  // via a popup rather than an inline panel (once set, rooms rarely change;
  // user decision 2026-08-19). The dialog loads/saves the venue doc itself,
  // deliberately decoupled from the event save.
  openVenueRooms(): void {
    this.dialog.open(VenueRoomsDialogComponent, { width: '760px', maxWidth: '95vw' });
  }

  // What the event's venue snapshot would be from the live form value -
  // also feeds the Info-tab preview card.
  private resolveVenue(raw: { isOnline?: boolean; location?: string | null; organization?: string | null }): EventVenue | null {
    if (this.summitMode) {
      const pinned = this.summitVenue();
      return pinned ? { name: pinned.name, address: pinned.address ?? {} } : null;
    }
    if (raw.isOnline) return null;
    const location = this.locations.find((l) => l.id === raw.location);
    if (location) return { name: location.name, address: location.address ?? {} };
    const org = this.organizations.find((o) => o.id === raw.organization);
    if (org) return { name: org.name, address: org.address ?? {} };
    return null;
  }

  private buildForm(item: EventModel): void {
    const locationId = typeof item.location === 'string' ? item.location : (item.location as LocationModel)?.id ?? null;
    const organizationId = typeof item.organization === 'string' ? item.organization : (item.organization as OrganizationModel)?.id ?? null;

    this.form = this.fb.group({
      isActive: [item.isActive ?? false],
      eventName: [item.eventName ?? '', Validators.required],
      emailTemplate: [item.emailTemplate ?? null],
      startDate: [this.toInputValue(item.startDate), Validators.required],
      endDate: [this.toInputValue(item.endDate)],
      checkIn: [toTimeValue(item.checkIn)],
      costInDollars: [item.costInDollars ?? 0],
      isSummit: [item.isSummit ?? false],
      earlyRegistration: [item.earlyRegistration ?? false],
      videoId: [item.videoId ?? ''],
      isOnline: [item.isOnline ?? false],
      isKajabiCourse: [item.isKajabiCourse ?? false],
      kajabiPurchaseURL: [item.kajabiPurchaseURL ?? ''],
      kajabiSubscribeURL: [item.kajabiSubscribeURL ?? ''],
      location: [locationId],
      organization: [organizationId],
      description: [item.description ?? '']
    });

    this.updateConditionalValidators();
    this.form.get('isOnline')?.valueChanges.subscribe(() => this.updateConditionalValidators());

    // Cascading Organization -> Location: switching org invalidates a
    // location that belongs to the previous org.
    this.form.get('organization')?.valueChanges.subscribe((orgId) => {
      const locationId = this.form.get('location')?.value;
      if (locationId && !this.locations.some((l) => l.id === locationId && l.organization === orgId)) {
        this.form.get('location')?.setValue(null);
      }
    });
  }

  // Mirrors the original's conditional [isRequired] bindings exactly,
  // including the (slightly unusual, but intentional - not a bug flagged
  // for fixing) rule that the Kajabi URLs are only actually *required*
  // when isOnline is true, not merely when isKajabiCourse is checked.
  private updateConditionalValidators(): void {
    const isOnline = this.form.get('isOnline')?.value;

    const toggle = (field: string, required: boolean) => {
      const control = this.form.get(field);
      control?.setValidators(required ? [Validators.required] : []);
      control?.updateValueAndValidity({ emitEvent: false });
    };

    toggle('emailTemplate', !isOnline);
    toggle('endDate', !isOnline);
    toggle('checkIn', !isOnline);
    // 2026-08 restructure: the ORGANIZATION is what an in-person event
    // requires now (its address alone is a complete venue); a location only
    // narrows a multi-site org to one site, so it's never required. Summit
    // needs neither - its venue is pinned (see resolveVenue()).
    toggle('organization', !isOnline && !this.summitMode);
    toggle('kajabiPurchaseURL', isOnline);
    toggle('kajabiSubscribeURL', isOnline);
  }

  private toInputValue(date: unknown): string {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date as string | number);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  showImageUploader(): void {
    this.isImageUploaderVisible$.next(true);
  }

  closeImageUploader(): void {
    this.isImageUploaderVisible$.next(false);
  }

  onCancel(): void {
    this.inProgress$.next(false);
    this.cancelled.emit();
  }

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.inProgress$.next(true);
    const raw = this.form.getRawValue();
    // this.card.imageUrl is undefined (not just falsy) for a brand new
    // event with no image uploaded yet - assigning that straight onto
    // `value` put an explicit `imageUrl: undefined` key on the object,
    // which Firestore's addDoc()/setDoc() reject outright ("Unsupported
    // field value: undefined"), the same class of bug already diagnosed
    // and fixed in PurchasesService.withStatusHistory() - build the key
    // conditionally instead of assigning unconditionally, so it's omitted
    // rather than present-with-undefined.
    // Venue snapshot (see EventModel.venue) - recomputed on every save so
    // re-saving an event picks up an org/location address change. null (not
    // undefined - Firestore rejects undefined) when online/unresolvable.
    const venue = this.resolveVenue(raw);
    // Summits always happen at the pinned venue - the form has no location
    // pick in summit mode, the save stamps it.
    const pinnedId = this.summitMode ? this.summitVenue()?.id : undefined;

    const value: EventModel = {
      ...this.item,
      ...raw,
      startDate: raw.startDate ? new Date(raw.startDate) : this.item?.startDate,
      endDate: raw.endDate ? new Date(raw.endDate) : this.item?.endDate,
      venue,
      ...(pinnedId ? { location: pinnedId } : {}),
      // A Summit is always in-person at the pinned venue and NEVER Kajabi
      // (user decision 2026-08-19 - Kajabi exists for other events that
      // are online-only or have an online component). Stamped here since
      // summit mode renders no controls for either flag.
      ...(this.summitMode ? { isOnline: false, isKajabiCourse: false } : {}),
      ...(this.card.imageUrl ? { imageUrl: this.card.imageUrl } : {})
    };

    const request = this.isEdit ? this.service.update(value.id!, value) : this.service.add(value);

    request.then((result) => {
      if (result) {
        this.snackbar.success(this.itemType + (this.isEdit ? ' Updated' : ' Added'));
        this.inProgress$.next(false);
        this.saved.emit(result);
      } else {
        this.inProgress$.next(false);
        this.snackbar.error('Some Error Occured');
      }
    });
  }
}
