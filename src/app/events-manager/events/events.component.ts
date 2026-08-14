import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { EventModel } from 'src/app/common/models/domain/event.model';
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
import { LocationsComponent } from '../locations/locations.component';
import { OrganizationsComponent } from '../organizations/organizations.component';

// Full-page in-place edit view (mode: 'list' | 'edit', no popup - see
// products.component.ts (store-manager) for the established precedent) -
// the densest form in the app, now also hosting a calendar (Agenda tab).
@Component({
    selector: 'app-events',
    templateUrl: './events.component.html',
    styleUrls: ['./events.component.scss'],
    standalone: false
})
export class EventsComponent implements OnInit {
  mode: 'list' | 'edit' = 'list';

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

  private readonly screenKey = 'events-manager.events';

  headerActions: ListHeaderAction[] = [];
  // Deleting an event has no cascading cleanup of its event-registrations -
  // orphaning them (missing eventId, stuck "new" forever since nothing can
  // resolve their startDate to suppress the bell) is exactly what happened
  // to the Disciple-Making Summit's registrations, live-diagnosed
  // 2026-08-12. Removed rather than fixed with a cascade, since there's no
  // real product need for staff to delete an event outright (see isActive
  // for retiring one instead) - don't re-add without also handling orphaned
  // registrations/agenda references.
  rowActions: DataGridRowAction<EventModel>[] = [];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  // Kept live for the whole component lifetime - serves the list's
  // Organization/Location name lookups AND the edit form's own selects, so
  // adding one via "Manage Locations"/"Manage Organizations" while editing
  // shows up in the select immediately. Same pattern as Products'
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
  // home-page-image-dialog.component.ts (web-manager) for the established
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
  private readonly tabOrder = ['info', 'application', 'agenda', 'attendees', 'breakouts'];

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

  ngOnInit(): void {
    this.authService.dao.loggedInUser$.subscribe(() => {
      this.headerActions = this.permissionService.canAdd(this.screenKey) ? [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }] : [];
    });

    this.organizationService.streamAll().subscribe((organizations) => {
      this.organizations = organizations;
    });
    this.locationService.streamAll().subscribe((locations) => {
      this.locations = locations;
    });
    this.emailTemplateService.getAll().then((templates) => {
      this.emailTemplates = templates.map((t) => t.name);
    });

    this.events$ = this.service.streamAll().pipe(tap(() => this.loading$.next(false)));

    this.registrationService.streamAllByValue('newRecordStatus', 'new').subscribe((registrations) => {
      this.newAttendeeEventIds = new Set(registrations.map((r) => r.eventId).filter((id): id is string => !!id));
    });

    // ?eventId=&eventTab= - deep-link from the new-record-alerts bell (or
    // any future caller) straight into one event's edit view on a specific
    // tab. Subscribed (not a one-time snapshot read) so clicking the bell
    // again while already sitting on this route still re-opens it, same
    // reasoning as events-manager.component.ts's own ?tab= handling.
    this.route.queryParamMap.subscribe((params) => {
      const eventId = params.get('eventId');
      if (eventId) {
        this.openEventFromDeepLink(eventId, params.get('eventTab') ?? 'info');
      }
    });
  }

  private openEventFromDeepLink(eventId: string, tabKey: string): void {
    this.service.getById(eventId).then((item) => {
      if (!item) {
        return;
      }
      this.showEditModal(item);
      this.selectedTabIndex = this.tabIndexFor(tabKey);
    });
  }

  private tabIndexFor(tabKey: string): number {
    const visible = this.tabOrder.filter((key) => this.permissionService.canView(`${this.screenKey}.${key}`));
    const index = visible.indexOf(tabKey);
    return index >= 0 ? index : 0;
  }

  organizationName(item: EventModel): string {
    const id = typeof item.organization === 'string' ? item.organization : item.organization?.id;
    return this.organizations.find((o) => o.id === id)?.name ?? '';
  }

  manageLocations(): void {
    this.dialog.open(LocationsComponent, { width: '1000px', maxWidth: '95vw' });
  }

  manageOrganizations(): void {
    this.dialog.open(OrganizationsComponent, { width: '900px', maxWidth: '95vw' });
  }

  // ---- Edit view ----

  showAddModal(): void {
    if (!this.permissionService.canAdd(this.screenKey)) {
      return;
    }
    this.editingItem = { ...new EventModel() };
    this.isEdit = false;
    this.card = {};
    this.selectedTabIndex = 0;
    this.buildForm(this.editingItem);
    this.mode = 'edit';
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
    toggle('location', !isOnline);
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
    const value: EventModel = {
      ...this.editingItem,
      ...raw,
      startDate: raw.startDate ? new Date(raw.startDate) : this.editingItem?.startDate,
      endDate: raw.endDate ? new Date(raw.endDate) : this.editingItem?.endDate,
      ...(this.card.imageUrl ? { imageUrl: this.card.imageUrl } : {})
    };

    const request = this.isEdit ? this.service.update(value.id!, value) : this.service.add(value);

    request.then((result) => {
      if (result) {
        this.snackbar.success(this.itemType + (this.isEdit ? ' Updated' : ' Added'));
        this.mode = 'list';
        this.inProgress$.next(false);
      } else {
        this.inProgress$.next(false);
        this.snackbar.error('Some Error Occured');
      }
    });
  }
}
