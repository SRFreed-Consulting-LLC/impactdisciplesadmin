import { Component, OnInit } from '@angular/core';
import { EventModel } from '@impact-common/shared/models/domain/event.model';
import { EventService } from 'src/app/common/services/data/event.service';
import { EventRegistrationModel } from '@impact-common/shared/models/domain/event-registration.model';
import { EventRegistrationService } from 'src/app/common/services/data/event-registration.service';
import { OrganizationModel } from '@impact-common/shared/models/domain/organization.model';
import { OrganizationService } from 'src/app/common/services/data/organization.service';
import { LocationModel } from '@impact-common/shared/models/domain/location.model';
import { LocationService } from 'src/app/common/services/data/location.service';
import { dateFromTimestamp, toMillis } from '@impact-common/shared/utils/date-from-timestamp';
import { ExcelColumn, exportToExcel } from '../../shared/table-export.util';
import { DataGridColumn } from '../../shared/data-grid/data-grid.model';

// Flat attendee row - regular events, and a summit event's "Full Report" mode.
interface AttendeeRow {
  id: string;
  lastName: string;
  firstName: string;
  email: string;
  registrationDate: Date | null;
  loggedIn: string;
  receipt: string;
}

// One row per (attendee, breakout session) pair.
interface BreakoutStudent {
  breakoutName: string;
  sessionDate: Date | null;
  lastName: string;
  firstName: string;
  email: string;
}

// A single time slot within a breakout - `key` is a toMillis() value
// (as a string, since it doubles as a Map/Set key) rather than the Date
// itself, sidestepping the "is this really a Date at runtime" problem
// documented on toSafeDate() below.
interface BreakoutSession {
  key: string;
  label: string;
  students: BreakoutStudent[];
}

// One collapsible section per breakout (course). `sessions` always has at
// least 1 entry - the template only renders it as its OWN collapsible layer
// when there's more than one (see isBreakoutCollapsed/isSessionCollapsed
// and the template's own comment).
interface BreakoutGroup {
  name: string;
  students: BreakoutStudent[];
  sessions: BreakoutSession[];
}

// Reports Manager > Events - pick an event, see its details + attendee list.
// Diverges from Purchase/Subscriber/Customer Report's own
// criteria-form-plus-"Generate Report"-button convention: there's only one
// real "criterion" here (which event), a required single-select rather than
// several optional checkboxed filters, so picking one just loads its data
// immediately rather than needing a separate submit step.
//
// Summit events (isSummit) add a second axis: a plain attendee list ("Full
// Report") vs. a breakout-session-grouped one. Breakout sign-up data isn't
// its own collection - EventRegistrationModel.trainingSessions is an array
// of agenda-item ids, cross-referenced against event.agendaItems (for
// session time) and the breakout item's own text (display name). This
// mirrors event-breakouts.component.ts's own flatten()/buildRows() logic
// rather than reusing that component directly - it's tightly coupled to
// being an @Input-driven tab inside the event-edit screen, with its own
// live-stream/filter-row state this report doesn't need (a report loads
// once per event/mode, same as the other 3 Reports Manager screens).
@Component({
    selector: 'app-event-report',
    templateUrl: './event-report.component.html',
    styleUrls: ['./event-report.component.scss'],
    standalone: false
})
export class EventReportComponent implements OnInit {
  events: EventModel[] = [];
  selectedEventId: string | null = null;
  selectedEvent: EventModel | null = null;

  organizationName = '';
  locationName = '';

  // Off (default) = every event in the picker. On = only isActive ones -
  // Firestore's own "currently live on the site" flag, not a past/future
  // distinction (a past event can still be isActive=false long after the
  // fact, or in principle still true - this filters on the flag as stored,
  // not derived from startDate).
  showLiveEventsOnly = false;

  // Off = Full Report, on = Breakout Sessions - only shown/relevant for a
  // summit event (see template).
  breakoutMode = false;

  attendeeColumns: DataGridColumn<AttendeeRow>[] = [
    { key: 'lastName', label: 'Last Name', sortable: false },
    { key: 'firstName', label: 'First Name', sortable: false },
    { key: 'email', label: 'Email', sortable: false },
    { key: 'registrationDate', label: 'Registration Date', type: 'date', dateFormat: 'short', sortable: false },
    { key: 'loggedIn', label: 'Logged In', sortable: false },
    { key: 'receipt', label: 'Receipt', sortable: false }
  ];

  attendees: AttendeeRow[] = [];
  breakoutGroups: BreakoutGroup[] = [];
  breakoutStudents: BreakoutStudent[] = [];

  // Both start every breakout (and, for a breakout with >1 time slot, every
  // session within it) collapsed - see setBreakoutGroups(). Keyed by
  // breakout name / `${breakoutName}||${sessionKey}` respectively.
  private collapsedBreakouts = new Set<string>();
  private collapsedSessions = new Set<string>();

  private registrations: EventRegistrationModel[] = [];

  loading = false;
  errorMessage: string | null = null;

  constructor(
    private eventService: EventService,
    private registrationService: EventRegistrationService,
    private organizationService: OrganizationService,
    private locationService: LocationService
  ) {}

  async ngOnInit(): Promise<void> {
    const events = await this.eventService.getAll();
    // Most-recent-first - a report tool is more often run against a recent
    // or upcoming event than something from years back.
    this.events = (events ?? []).sort((a, b) => toMillis(b.startDate) - toMillis(a.startDate));
  }

  eventLabel(event: EventModel): string {
    const date = dateFromTimestamp(event.startDate);
    return date ? `${event.eventName} (${date.toLocaleDateString()})` : event.eventName ?? '';
  }

  get visibleEvents(): EventModel[] {
    return this.showLiveEventsOnly ? this.events.filter((e) => e.isActive) : this.events;
  }

  get hasResults(): boolean {
    return this.breakoutMode ? this.breakoutStudents.length > 0 : this.attendees.length > 0;
  }

  // EventModel.startDate/endDate are typed Timestamp | Date | string (even
  // though EventService.fromFirestore already normalizes them to a real
  // Date at runtime) - Angular's DatePipe only accepts string | number |
  // Date, so the template binds these getters instead of the raw field.
  get eventStartDate(): Date | null {
    return dateFromTimestamp(this.selectedEvent?.startDate);
  }

  get eventEndDate(): Date | null {
    return dateFromTimestamp(this.selectedEvent?.endDate);
  }

  async onEventSelected(): Promise<void> {
    this.selectedEvent = this.events.find((e) => e.id === this.selectedEventId) ?? null;
    this.breakoutMode = false;
    this.attendees = [];
    this.breakoutGroups = [];
    this.breakoutStudents = [];
    this.registrations = [];
    this.organizationName = '';
    this.locationName = '';
    this.errorMessage = null;

    if (!this.selectedEvent) {
      return;
    }

    this.loading = true;
    try {
      const [registrations] = await Promise.all([
        this.registrationService.getAllByValue('eventId', this.selectedEvent.id),
        this.resolveOrganizationName(this.selectedEvent),
        this.resolveLocationName(this.selectedEvent)
      ]);
      this.registrations = registrations ?? [];
      this.attendees = this.registrations.map((item) => this.toAttendeeRow(item)).sort((a, b) => a.lastName.localeCompare(b.lastName));
    } catch (err) {
      this.errorMessage = (err as { message?: string })?.message ?? 'Something went wrong loading this event.';
    } finally {
      this.loading = false;
    }
  }

  // Breakout sign-ups are derived from the same registrations already
  // fetched for the Full Report - no second Firestore round trip; breakout
  // names come off the agenda items themselves (Courses retirement).
  async onBreakoutModeChange(): Promise<void> {
    if (!this.breakoutMode || !this.selectedEvent || this.breakoutStudents.length > 0) {
      return;
    }

    this.loading = true;
    try {
      this.breakoutStudents = this.flattenBreakouts(this.registrations);
      this.setBreakoutGroups(this.buildBreakoutGroups(this.breakoutStudents));
    } catch (err) {
      this.errorMessage = (err as { message?: string })?.message ?? 'Something went wrong loading breakout sign-ups.';
    } finally {
      this.loading = false;
    }
  }

  private sessionMapKey(breakoutName: string, sessionKey: string): string {
    return `${breakoutName}||${sessionKey}`;
  }

  // Every section starts collapsed - a summit with several breakouts (each
  // with several time slots) rendered fully expanded is exactly the "one
  // giant list" this was built to avoid.
  private setBreakoutGroups(groups: BreakoutGroup[]): void {
    this.breakoutGroups = groups;
    this.collapsedBreakouts = new Set(groups.map((g) => g.name));
    this.collapsedSessions = new Set(
      groups.flatMap((g) => (g.sessions.length > 1 ? g.sessions.map((s) => this.sessionMapKey(g.name, s.key)) : []))
    );
  }

  toggleBreakout(name: string): void {
    if (this.collapsedBreakouts.has(name)) {
      this.collapsedBreakouts.delete(name);
    } else {
      this.collapsedBreakouts.add(name);
    }
  }

  isBreakoutCollapsed(name: string): boolean {
    return this.collapsedBreakouts.has(name);
  }

  toggleSession(breakoutName: string, sessionKey: string): void {
    const key = this.sessionMapKey(breakoutName, sessionKey);
    if (this.collapsedSessions.has(key)) {
      this.collapsedSessions.delete(key);
    } else {
      this.collapsedSessions.add(key);
    }
  }

  isSessionCollapsed(breakoutName: string, sessionKey: string): boolean {
    return this.collapsedSessions.has(this.sessionMapKey(breakoutName, sessionKey));
  }

  // `location`/`organization` are each either a full object (freshly picked
  // in a form) or just an id string (as loaded from Firestore) - same
  // typeof check as events.component.ts's own organizationName().
  private async resolveOrganizationName(event: EventModel): Promise<void> {
    if (!event.organization) {
      return;
    }
    if (typeof event.organization !== 'string') {
      this.organizationName = (event.organization as OrganizationModel).name ?? '';
      return;
    }
    const org = await this.organizationService.getById(event.organization);
    this.organizationName = org?.name ?? '';
  }

  private async resolveLocationName(event: EventModel): Promise<void> {
    // Venue snapshot first (2026-08 restructure) - an event at a
    // single-site org has no location record at all.
    if (event.venue?.name) {
      this.locationName = event.venue.name;
      return;
    }
    if (!event.location) {
      return;
    }
    if (typeof event.location !== 'string') {
      this.locationName = (event.location as LocationModel).name ?? '';
      return;
    }
    const location = await this.locationService.getById(event.location);
    this.locationName = location?.name ?? '';
  }

  private toAttendeeRow(item: EventRegistrationModel): AttendeeRow {
    return {
      id: item.id!,
      lastName: item.lastName ?? '',
      firstName: item.firstName ?? '',
      email: item.email ?? '',
      registrationDate: this.toSafeDate(item.registrationDate),
      loggedIn: item.loggedIn ? 'Yes' : 'No',
      receipt: item.receipt ?? ''
    };
  }

  // dateFromTimestamp() only converts a real Timestamp/{seconds,nanoseconds}
  // map or an "MM/dd/yyyy" string - an ISO string ("2026-01-30T02:00:00"),
  // which is how agendaItems' startDate (and other date fields) are often
  // actually stored (see MIGRATION.md's "Date fields: inconsistent storage
  // shapes" entry), passes straight through UNCONVERTED, still a string.
  // Both call sites below used to assume the Date|null they're typed as is
  // really a Date at runtime and called Date-only methods on it
  // (.toISOString()) - crashing ("...toISOString is not a function") the
  // moment a real-world ISO-string date showed up. toMillis() is the
  // codebase's own canonical fix for exactly this (see its own comment in
  // date-from-timestamp.ts) - route through it instead of trusting the
  // static type.
  private toSafeDate(value: unknown): Date | null {
    const ms = toMillis(value);
    return ms > 0 ? new Date(ms) : null;
  }

  // trainingSessions holds agenda-item ids, matched against this event's
  // agendaItems for session time and - since the 2026-08 Courses
  // retirement - the breakout's own `text` for the display name (backfilled
  // from the old course docs by scripts/flatten-courses-onto-agenda-items.js).
  // A session pointing at a deleted agenda item is skipped; an item with no
  // title shows '(unknown breakout)' rather than silently dropping the
  // student from the report.
  private flattenBreakouts(registrations: EventRegistrationModel[]): BreakoutStudent[] {
    const agendaItems = this.selectedEvent?.agendaItems ?? [];
    const students: BreakoutStudent[] = [];

    registrations.forEach((reg) => {
      (reg.trainingSessions ?? []).forEach((session) => {
        const agendaItem = agendaItems.find((item) => item.id == session);
        if (!agendaItem) {
          return;
        }
        students.push({
          breakoutName: agendaItem.text || '(unknown breakout)',
          sessionDate: this.toSafeDate(agendaItem.startDate),
          lastName: reg.lastName ?? '',
          firstName: reg.firstName ?? '',
          email: reg.email ?? ''
        });
      });
    });

    return students;
  }

  // Same 2-level grouping as event-breakouts.component.ts's own
  // buildRows() - breakout, then time-session within it - but returns a
  // real nested tree (BreakoutGroup[]) rather than a synthesized flat row
  // list for a mat-table DataSource: collapse/expand needs to hide whole
  // subtrees, which is straightforward with @for + @if over a tree and
  // awkward to retrofit onto a flat mat-table row list.
  private buildBreakoutGroups(students: BreakoutStudent[]): BreakoutGroup[] {
    const byBreakout = new Map<string, BreakoutStudent[]>();
    students.forEach((s) => {
      const list = byBreakout.get(s.breakoutName) ?? [];
      list.push(s);
      byBreakout.set(s.breakoutName, list);
    });

    return Array.from(byBreakout.keys())
      .sort()
      .map((breakoutName) => {
        const breakoutStudents = byBreakout.get(breakoutName)!;

        // Numeric key via toMillis() rather than s.sessionDate.toISOString()
        // - sessionDate is already routed through toSafeDate() above so
        // it's a real Date or null by this point, but grouping by a plain
        // number is simpler and matches this codebase's own convention
        // (toMillis is the canonical "give me a sortable number" helper)
        // rather than re-introducing a Date-only method call here too.
        const bySession = new Map<number, BreakoutStudent[]>();
        breakoutStudents.forEach((s) => {
          const key = toMillis(s.sessionDate);
          const list = bySession.get(key) ?? [];
          list.push(s);
          bySession.set(key, list);
        });

        const sessions: BreakoutSession[] = Array.from(bySession.keys())
          .sort((a, b) => a - b)
          .map((key) => ({
            key: String(key),
            label: key > 0 ? new Date(key).toLocaleTimeString() : 'Time TBD',
            students: bySession.get(key)!.sort((a, b) => a.lastName.localeCompare(b.lastName))
          }));

        return { name: breakoutName, students: breakoutStudents, sessions };
      });
  }

  exportExcel(): void {
    if (!this.selectedEvent) {
      return;
    }

    if (this.breakoutMode) {
      const columns: ExcelColumn<BreakoutStudent>[] = [
        { header: 'Breakout Session', value: (row) => row.breakoutName },
        { header: 'Session Time', value: (row) => row.sessionDate ?? '' },
        { header: 'Last Name', value: (row) => row.lastName },
        { header: 'First Name', value: (row) => row.firstName },
        { header: 'Email', value: (row) => row.email }
      ];
      exportToExcel(this.breakoutStudents, columns, 'event-breakout-report.xlsx');
      return;
    }

    const columns: ExcelColumn<AttendeeRow>[] = [
      { header: 'Last Name', value: (row) => row.lastName },
      { header: 'First Name', value: (row) => row.firstName },
      { header: 'Email', value: (row) => row.email },
      { header: 'Registration Date', value: (row) => row.registrationDate ?? '' },
      { header: 'Logged In', value: (row) => row.loggedIn },
      { header: 'Receipt', value: (row) => row.receipt }
    ];
    exportToExcel(this.attendees, columns, 'event-attendee-report.xlsx');
  }
}
