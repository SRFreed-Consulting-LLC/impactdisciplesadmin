import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { BehaviorSubject, Observable, Subject, map, takeUntil, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { EventModel, EventVenue } from 'src/app/common/models/domain/event.model';
import { VenueRoomsDialogComponent } from './venue-rooms-dialog.component';
import { SummitPreviewData } from './summit-preview/summit-preview.component';
import { EventService } from 'src/app/common/services/data/event.service';
import { EventRegistrationService } from 'src/app/common/services/data/event-registration.service';
import { OrganizationModel } from 'src/app/common/models/domain/organization.model';
import { OrganizationService } from 'src/app/common/services/data/organization.service';
import { LocationModel } from 'src/app/common/models/domain/location.model';
import { LocationService } from 'src/app/common/services/data/location.service';
import { EMailTemplatesService } from 'src/app/common/services/data/email-templates.service';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { toMillis } from 'src/app/common/utils/date-from-timestamp';
import { ImageModel } from 'src/app/common/models/utils/image.model';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';

// Full-page in-place edit view (mode: 'list' | 'edit', no popup - see
// products.component.ts (store-manager) for the established precedent) -
// the densest form in the app, now also hosting a calendar (Agenda tab).
@Component({
    selector: 'app-events',
    templateUrl: './events.component.html',
    styleUrls: ['./events.component.scss'],
    standalone: false
})
export class EventsComponent implements OnInit, OnDestroy {
  // Summit vs regular Events are two separate left-nav items now
  // (events-manager.component.html), both rendering this same component -
  // see nav-config.ts's own comment on why the permission grants are
  // deliberately separate rather than sharing one screenKey. Sourced from
  // NAV_CONFIG's own two slugs ('summit' / 'events'), not duplicated here.
  @Input() summitMode = false;

  // Summit-only modes beyond list/edit (regular events keep list/edit):
  // - 'hub': Mission Control - what double-clicking a summit row lands on
  //   (user decision 2026-08-19: an operations overview, editing one click
  //   deeper). Its cards emit back here to open the editor at a tab or the
  //   Command Center.
  // - 'attendees': the full-page attendee Command Center (viewing who
  //   registered + breakout sign-ups is a report/operations concern, not
  //   an editing one).
  // - 'wizard': the New Summit guided setup (summit showAddModal routes
  //   here; regular events keep the plain form).
  mode: 'list' | 'edit' | 'hub' | 'attendees' | 'wizard' = 'list';
  attendeesItem: EventModel | null = null;
  hubItem: EventModel | null = null;
  // Latest list emission - feeds the wizard's copy-from-previous-summit
  // select without a second fetch.
  latestEvents: EventModel[] = [];

  // ---- List state ----
  events$: Observable<EventModel[]>;
  columns: DataGridColumn<EventModel>[] = [
    { key: 'isActive', label: 'Live', filterable: false, sortFn: (a, b) => Number(a.isActive) - Number(b.isActive) },
    { key: 'newAttendees', label: 'New', filterable: false, sortable: false, value: (item) => this.newAttendeeEventIds.has(item.id!) },
    { key: 'startDate', label: 'From', type: 'date', dateFormat: 'MMM d, y, h:mm a', filterable: false, sortFn: (a, b) => toMillis(a.startDate) - toMillis(b.startDate) },
    { key: 'endDate', label: 'To', type: 'date', dateFormat: 'MMM d, y, h:mm a', filterable: false, sortFn: (a, b) => toMillis(a.endDate) - toMillis(b.endDate) },
    { key: 'costInDollars', label: 'Cost', type: 'currency' },
    { key: 'eventName', label: 'Event Name' },
    { key: 'organization', label: 'Organization', value: (item) => this.organizationName(item) }
  ];

  itemType = 'Event';

  // Getter, not a plain field - was a hardcoded private string before the
  // Summit/Events nav split. Public (not private) because the template
  // also gates each tab's visibility off this same key
  // (permissionService.canView(screenKey + '.info') etc.) - every existing
  // canAdd()/canEdit()/canView() call site, in both this class and the
  // template, reads through this one property, so keying it off
  // summitMode here is the one place that needs to change for every
  // permission check to route to the right grant.
  get screenKey(): string {
    return this.summitMode ? 'events-manager.summit' : 'events-manager.events';
  }

  headerActions: ListHeaderAction[] = [];
  // No DELETE action: deleting an event has no cascading cleanup of its
  // event-registrations - orphaning them (missing eventId, stuck "new"
  // forever since nothing can resolve their startDate to suppress the
  // bell) is exactly what happened to the Disciple-Making Summit's
  // registrations, live-diagnosed 2026-08-12. Removed rather than fixed
  // with a cascade, since there's no real product need for staff to delete
  // an event outright (see isActive for retiring one instead) - don't
  // re-add without also handling orphaned registrations/agenda references.
  // Summit rows get a VIEW ATTENDEES report action instead (see `mode`) -
  // populated in ngOnInit, after summitMode (an @Input) is actually set.
  rowActions: DataGridRowAction<EventModel>[] = [];

  // House rule: loading spinner shown until first emission - see
  // contacts.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  // Kept live for the whole component lifetime - serves the list's
  // Organization name lookup AND the edit form's cascading Organization ->
  // Location selects (an org added on Contacts Manager > Organizations
  // shows up here immediately). Same pattern as Products'
  // categories/series arrays.
  organizations: OrganizationModel[] = [];
  locations: LocationModel[] = [];
  emailTemplates: string[] = [];

  // Live-updated set of event IDs with at least one not-yet-seen attendee
  // registration - drives both the "New" list-column badge and the
  // Attendees tab badge in the edit view (see events.component.html). Just
  // one extra standing listener for the whole screen, scoped to the
  // (normally small) still-unseen subset via the newRecordStatus == 'new'
  // filter, not a listener per event. Recomputes itself for free the
  // moment NewRecordTracker (inside event-attendees.component.ts) flips a
  // registration to 'seen' - that write no longer matches the filter, so
  // it drops out of this same live query.
  newAttendeeEventIds = new Set<string>();

  // ---- Edit state ----
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit = false;

  isImageUploaderVisible$ = new BehaviorSubject<boolean>(false);

  // Backs app-image-uploader's [card]/[field] inputs directly - see
  // home-page-image-dialog.component.ts (content-manager) for the established
  // explanation of this pattern.
  card: { imageUrl?: ImageModel } = {};

  // The live EventModel instance itself - not just a form value. Agenda/
  // Attendees/Break Outs/Application all take this object directly and
  // mutate fields on it in place (agendaItems, diningOptions, faqList,
  // etc.), exactly like the original's [(formData)]="selectedItem"
  // two-way binding did for the whole object. The Info tab's own fields
  // live in `form` instead and get merged back on top of this object at
  // Save time - the two field sets never overlap.
  editingItem: EventModel | null = null;

  // Which tab the mat-tab-group has open - always reset to 0 (Info) by
  // showAddModal()/showEditModal() themselves; only overridden afterward by
  // the ?eventId=&eventTab= deep-link path below (the new-record-alerts
  // bell's "Event Registrations" entry, so clicking it lands directly on
  // the specific event's Attendees tab instead of the bare Events list -
  // see new-record-alerts.component.ts). Tab *ngIf visibility is
  // permission-gated, so the same tab key ('attendees') can sit at a
  // different index per admin - tabIndexFor() re-derives the real index
  // from the same canView() checks the template itself uses, rather than
  // hardcoding a position.
  selectedTabIndex = 0;
  // No 'attendees' - on a summit that's the full-page report off the list
  // row (see mode above), not an edit tab.
  private readonly tabOrderSummit = ['info', 'application', 'agenda'];
  // Regular events only ever show Details (still keyed 'info' for
  // permission/deep-link continuity - see nav-config.ts) and Attendees -
  // Application/Agenda/Break Outs don't exist on this screen at all.
  private readonly tabOrderRegular = ['info', 'attendees'];

  constructor(
    private service: EventService,
    private registrationService: EventRegistrationService,
    private organizationService: OrganizationService,
    private locationService: LocationService,
    private emailTemplateService: EMailTemplatesService,
    private authService: AdminAuthService,
    public permissionService: PermissionService,
    private fb: FormBuilder,
    private dialog: MatDialog,
    private snackbar: SnackbarService,
    private route: ActivatedRoute
  ) {}

  private ngUnsubscribe = new Subject<void>();

  ngOnInit(): void {
    this.authService.dao.loggedInUser$.pipe(takeUntil(this.ngUnsubscribe)).subscribe(() => {
      const label = this.summitMode ? 'New Summit' : 'New Event';
      this.headerActions = this.permissionService.canAdd(this.screenKey) ? [{ label, icon: 'add', onClick: () => this.showAddModal() }] : [];
      this.rowActions = this.summitMode
        ? [{ icon: 'hub', tooltip: 'COMMAND CENTER', onClick: (item) => this.showAttendees(item), visible: () => this.permissionService.canView(`${this.screenKey}.attendees`) }]
        : [];
    });

    this.organizationService.streamAll().pipe(takeUntil(this.ngUnsubscribe)).subscribe((organizations) => {
      this.organizations = organizations;
    });
    this.locationService.streamAll().pipe(takeUntil(this.ngUnsubscribe)).subscribe((locations) => {
      this.locations = locations;
    });
    this.emailTemplateService.getAll().then((templates) => {
      this.emailTemplates = templates.map((t) => t.name);
    });

    // Both Summit and Events read the same collection/stream - filtered
    // client-side rather than a second scoped Firestore query, since the
    // whole collection is small (29 documents in dev) and this avoids
    // needing a composite index for an isSummit-equality query on top of
    // whatever else this stream might filter on later.
    this.events$ = this.service.streamAll().pipe(
      map((items) => items.filter((item) => !!item.isSummit === this.summitMode)),
      tap((items) => {
        this.latestEvents = items;
        this.loading$.next(false);
      })
    );

    this.registrationService.streamAllByValue('newRecordStatus', 'new').pipe(takeUntil(this.ngUnsubscribe)).subscribe((registrations) => {
      this.newAttendeeEventIds = new Set(registrations.map((r) => r.eventId).filter((id): id is string => !!id));
    });

    // ?eventId=&eventTab= - deep-link from the new-record-alerts bell (or
    // any future caller) straight into one event's edit view on a specific
    // tab. Subscribed (not a one-time snapshot read) so clicking the bell
    // again while already sitting on this route still re-opens it, same
    // reasoning as events-manager.component.ts's own ?tab= handling.
    this.route.queryParamMap.pipe(takeUntil(this.ngUnsubscribe)).subscribe((params) => {
      const eventId = params.get('eventId');
      if (eventId) {
        this.openEventFromDeepLink(eventId, params.get('eventTab') ?? 'info');
      }
    });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  private openEventFromDeepLink(eventId: string, tabKey: string): void {
    this.service.getById(eventId).then((item) => {
      if (!item) {
        return;
      }
      // On a summit, "attendees" is the full-page report, not an edit tab -
      // the new-record-alerts bell's registration deep-link lands there.
      if (this.summitMode && tabKey === 'attendees') {
        this.showAttendees(item);
        return;
      }
      this.showEditModal(item);
      this.selectedTabIndex = this.tabIndexFor(tabKey);
    });
  }

  // ---- Summit Mission Control hub (see `mode`) ----

  showHub(item: EventModel): void {
    this.hubItem = item;
    this.mode = 'hub';
  }

  closeHub(): void {
    this.hubItem = null;
    this.mode = 'list';
  }

  // Where a summit editor/Command Center opened from the hub returns to on
  // back/save - null means "came from somewhere else, return to the list"
  // (bell deep-links, the list's own COMMAND CENTER row action).
  private hubReturnItem: EventModel | null = null;

  // A hub card asked for the editor at a specific SECTION. In summit mode
  // the editor is single-section (no tab strip - Mission Control's cards
  // ARE the section navigation, user decision 2026-08-20), so this both
  // selects the section and remembers to come back here.
  editFromHub(tabKey: string): void {
    const item = this.hubItem!;
    this.closeHub();
    this.hubReturnItem = item;
    this.showEditModal(item);
    this.selectedTabIndex = this.tabIndexFor(tabKey);
  }

  commandCenterFromHub(): void {
    const item = this.hubItem!;
    this.closeHub();
    this.hubReturnItem = item;
    this.showAttendees(item);
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

  // Row double-click: summits land on Mission Control, regular events go
  // straight to the editor (user decision 2026-08-19).
  onRowOpen(item: EventModel): void {
    if (this.summitMode) {
      this.showHub(item);
    } else {
      this.showEditModal(item);
    }
  }

  // ---- Summit attendee Command Center (see `mode`) ----

  showAttendees(item: EventModel): void {
    if (!this.permissionService.canView(`${this.screenKey}.attendees`)) {
      return;
    }
    this.attendeesItem = item;
    this.mode = 'attendees';
  }

  closeAttendees(): void {
    this.attendeesItem = null;
    if (this.hubReturnItem) {
      const item = this.hubReturnItem;
      this.hubReturnItem = null;
      this.showHub(item);
      return;
    }
    this.mode = 'list';
  }

  private tabIndexFor(tabKey: string): number {
    const tabOrder = this.summitMode ? this.tabOrderSummit : this.tabOrderRegular;
    const visible = tabOrder.filter((key) => this.permissionService.canView(`${this.screenKey}.${key}`));
    const index = visible.indexOf(tabKey);
    return index >= 0 ? index : 0;
  }

  organizationName(item: EventModel): string {
    const id = typeof item.organization === 'string' ? item.organization : item.organization?.id;
    return this.organizations.find((o) => o.id === id)?.name ?? '';
  }

  // ---- Info tab preview card ----
  // Reads the *live form value*, not a saved EventModel (unlike
  // organizationName() above, which resolves an already-saved item for the
  // list grid) - the preview updates as the admin types, before Save.
  // Angular re-evaluates this each change-detection cycle from the
  // template, same as the existing `card.imageUrl?.name` reads already do
  // - no manual valueChanges subscription needed.
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
      // Application/Agenda/FAQ child components mutate editingItem IN
      // PLACE pre-save, so reading it here keeps the preview live across
      // every section, not just the one being edited.
      diningOptions: this.editingItem?.diningOptions ?? null,
      checkinInstructions: this.editingItem?.checkinInstructions ?? null,
      whatsNext: this.editingItem?.whatsNext ?? null,
      faqList: this.editingItem?.faqList ?? null,
      agendaItems: this.editingItem?.agendaItems ?? null
    };
  }

  // Mission Control's rail previews the SAVED summit (the hub doesn't edit).
  hubPreviewData(): SummitPreviewData {
    const item = this.hubItem;
    if (!item) return {};
    return {
      eventName: item.eventName,
      startDate: item.startDate as Date | string,
      endDate: item.endDate as Date | string,
      checkIn: this.toTimeValue(item.checkIn),
      description: item.description,
      videoId: item.videoId,
      imageUrl: item.imageUrl ?? null,
      venue: item.venue ?? null,
      costInDollars: item.costInDollars,
      diningOptions: item.diningOptions ?? null,
      checkinInstructions: item.checkinInstructions ?? null,
      whatsNext: item.whatsNext ?? null,
      faqList: item.faqList ?? null,
      agendaItems: item.agendaItems ?? null
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
  //                an optional Kajabi add-on - real dev data already has
  //                more events with a Kajabi URL set than events marked
  //                Online, so this combination already happens today, it
  //                just wasn't a first-class choice in the old checkbox UI)
  // updateConditionalValidators() already toggles required-ness purely off
  // isOnline, so Location/Check-in stay required for Both (still
  // in-person) and the Kajabi URLs stay optional for it (a bonus, not the
  // primary registration path) with no changes needed to that method.
  regularAttendanceType(): 'inperson' | 'online' | 'both' {
    if (this.form?.get('isOnline')?.value) return 'online';
    if (this.form?.get('isKajabiCourse')?.value) return 'both';
    return 'inperson';
  }

  setRegularAttendanceType(type: 'inperson' | 'online' | 'both'): void {
    this.form.get('isOnline')?.setValue(type === 'online');
    this.form.get('isKajabiCourse')?.setValue(type === 'online' || type === 'both');
  }

  // ---- Venue (2026-08 restructure): organization -> optional location ----
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
  // via a popup rather than an inline panel (once set, rooms rarely
  // change; user decision 2026-08-19). The dialog loads/saves the venue
  // doc itself, deliberately decoupled from the event save.
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

  // ---- Edit view ----

  showAddModal(): void {
    if (!this.permissionService.canAdd(this.screenKey)) {
      return;
    }
    // New SUMMITS go through the guided setup wizard (user decision
    // 2026-08-19); regular events keep the plain form. Existing summits
    // still edit through the tab editor.
    if (this.summitMode) {
      this.mode = 'wizard';
      return;
    }
    this.editingItem = { ...new EventModel(), isSummit: this.summitMode };
    this.isEdit = false;
    this.card = {};
    this.selectedTabIndex = 0;
    this.buildForm(this.editingItem);
    this.mode = 'edit';
  }

  onWizardClosed(): void {
    this.mode = 'list';
  }

  // The wizard created the doc - back to the list (the live stream shows
  // it immediately).
  onWizardPublished(): void {
    this.mode = 'list';
  }

  showEditModal(item: EventModel): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.editingItem = { ...item };
    this.isEdit = true;
    this.card = { imageUrl: item.imageUrl };
    this.selectedTabIndex = 0;
    this.buildForm(this.editingItem);
    this.mode = 'edit';
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
      checkIn: [this.toTimeValue(item.checkIn)],
      costInDollars: [item.costInDollars ?? 0],
      isSummit: [item.isSummit ?? false],
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

  // checkIn is actually persisted as a plain "HH:mm" string (see onSave() -
  // unlike startDate/endDate it's never converted to a Date, despite
  // EventModel typing the field as Timestamp), which is already exactly
  // the shape <input type="time"> wants back - returning it directly here
  // was the missing piece. Without this, a saved check-in time appeared to
  // work (the string really was written) but silently failed to redisplay
  // on the next edit: `new Date("14:30")` alone isn't a valid date, so the
  // old code always fell through to returning ''.
  private toTimeValue(value: unknown): string {
    if (!value) return '';
    if (typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)) {
      return value;
    }
    const d = value instanceof Date ? value : new Date(value as string | number);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  showImageUploader(): void {
    this.isImageUploaderVisible$.next(true);
  }

  closeImageUploader(): void {
    this.isImageUploaderVisible$.next(false);
  }

  onCancel(): void {
    this.inProgress$.next(false);
    if (this.hubReturnItem) {
      // Cancel returns to Mission Control showing the ORIGINAL item (the
      // edit copy's uncommitted changes are discarded with it).
      const item = this.hubReturnItem;
      this.hubReturnItem = null;
      this.showHub(item);
      return;
    }
    this.mode = 'list';
  }

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.inProgress$.next(true);
    const raw = this.form.getRawValue();
    // this.card.imageUrl is undefined (not just falsy) for a brand new
    // event with no image uploaded yet (showAddModal() sets this.card =
    // {}, no imageUrl key at all) - assigning that straight onto `value`
    // put an explicit `imageUrl: undefined` key on the object, which
    // Firestore's addDoc()/setDoc() reject outright ("Unsupported field
    // value: undefined"), the same class of bug already diagnosed and
    // fixed in PurchasesService.withStatusHistory() (see that file's own
    // comment) - build the key conditionally instead of assigning
    // unconditionally, so it's omitted rather than present-with-undefined.
    // Venue snapshot (see EventModel.venue) - recomputed on every save so
    // re-saving an event picks up an org/location address change. null (not
    // undefined - Firestore rejects undefined) when online/unresolvable.
    const venue = this.resolveVenue(raw);
    // Summits always happen at the pinned venue - the form has no location
    // pick in summit mode, the save stamps it.
    const pinnedId = this.summitMode ? this.summitVenue()?.id : undefined;

    const value: EventModel = {
      ...this.editingItem,
      ...raw,
      startDate: raw.startDate ? new Date(raw.startDate) : this.editingItem?.startDate,
      endDate: raw.endDate ? new Date(raw.endDate) : this.editingItem?.endDate,
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
        if (this.hubReturnItem) {
          // Came from Mission Control - return there showing the SAVED
          // item so its tiles/statuses reflect the edit immediately.
          this.hubReturnItem = null;
          this.showHub(result);
        } else {
          this.mode = 'list';
        }
        this.inProgress$.next(false);
      } else {
        this.inProgress$.next(false);
        this.snackbar.error('Some Error Occured');
      }
    });
  }
}
