import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject, Observable, Subject, map, takeUntil, tap } from 'rxjs';
import { EventModel } from '@impact-common/shared/models/domain/event.model';
import { EventService } from 'src/app/common/services/data/event.service';
import { EventRegistrationService } from 'src/app/common/services/data/event-registration.service';
import { OrganizationModel } from '@impact-common/shared/models/domain/organization.model';
import { OrganizationService } from 'src/app/common/services/data/organization.service';
import { LocationModel } from '@impact-common/shared/models/domain/location.model';
import { LocationService } from 'src/app/common/services/data/location.service';
import { EMailTemplatesService } from 'src/app/common/services/data/email-templates.service';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { toMillis } from '@impact-common/shared/utils/date-from-timestamp';
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
  // The form itself lives in EventFormComponent (extracted 2026-08-21); what
  // stays here is only what the LIST screen needs to hand it.
  isEdit = false;

  // The working COPY handed to app-event-form. Cloned from the list row on
  // purpose: the editor's tab children mutate this object in place, so an
  // abandoned edit must not be able to scribble on the row the grid is
  // still rendering. The same reference travels down to app-event-form and
  // on to its tab children - see that component's own comment.
  editingItem: EventModel | null = null;

  // Which section the editor should open on, as a tab KEY. The real index
  // depends on which tabs the admin can see, so resolving it belongs with
  // the tab strip (EventFormComponent.tabIndexFor) - the list screen only
  // knows the intent: 'info' normally, or a specific section when a hub
  // card or a bell deep-link asked for one.
  pendingTabKey = 'info';

  constructor(
    private service: EventService,
    private registrationService: EventRegistrationService,
    private organizationService: OrganizationService,
    private locationService: LocationService,
    private emailTemplateService: EMailTemplatesService,
    private authService: AdminAuthService,
    public permissionService: PermissionService,
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
      this.pendingTabKey = tabKey;
      this.showEditModal(item);
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
    this.pendingTabKey = tabKey;
    this.showEditModal(item);
  }

  commandCenterFromHub(): void {
    const item = this.hubItem!;
    this.closeHub();
    this.hubReturnItem = item;
    this.showAttendees(item);
  }
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

  organizationName(item: EventModel): string {
    const id = typeof item.organization === 'string' ? item.organization : item.organization?.id;
    return this.organizations.find((o) => o.id === id)?.name ?? '';
  }

  // ---- Edit view (the form itself is app-event-form) ----

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
    this.pendingTabKey = 'info';
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
    this.mode = 'edit';
  }

  // app-event-form saved successfully and handed back the stored doc.
  onFormSaved(result: EventModel): void {
    if (this.hubReturnItem) {
      // Came from Mission Control - return there showing the SAVED item so
      // its tiles/statuses reflect the edit immediately.
      this.hubReturnItem = null;
      this.showHub(result);
      return;
    }
    this.mode = 'list';
  }

  onCancel(): void {
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
}
