import { Component, OnInit } from '@angular/core';
import { EventModel } from 'src/app/common/models/domain/event.model';
import { EventService } from 'src/app/common/services/data/event.service';
import { EventRegistrationModel } from 'src/app/common/models/domain/event-registration.model';
import { EventRegistrationService } from 'src/app/common/services/data/event-registration.service';
import { CourseModel } from 'src/app/common/models/domain/course.model';
import { CourseService } from 'src/app/common/services/data/course.service';
import { OrganizationModel } from 'src/app/common/models/domain/organization.model';
import { OrganizationService } from 'src/app/common/services/data/organization.service';
import { LocationModel } from 'src/app/common/models/domain/location.model';
import { LocationService } from 'src/app/common/services/data/location.service';
import { dateFromTimestamp, toMillis } from 'src/app/common/utils/date-from-timestamp';
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

// Rows synthesized for the mat-table - matColumnDef/matRowDef "when"
// predicates pick a different row template per kind, same approach as
// event-breakouts.component.ts's own BreakoutRow.
type BreakoutRow =
  | { kind: 'breakout'; label: string; count: number }
  | { kind: 'session'; label: string; count: number }
  | { kind: 'student'; firstName: string; lastName: string; email: string };

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
// session time) and the courses collection (for the display name). This
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
  breakoutRows: BreakoutRow[] = [];
  breakoutStudents: BreakoutStudent[] = [];

  private registrations: EventRegistrationModel[] = [];
  private courses: CourseModel[] = [];
  private coursesLoaded = false;

  loading = false;
  errorMessage: string | null = null;

  constructor(
    private eventService: EventService,
    private registrationService: EventRegistrationService,
    private courseService: CourseService,
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
    this.breakoutRows = [];
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
  // fetched for the Full Report - no second Firestore round trip, just the
  // courses collection loaded once and cached across event/mode switches.
  async onBreakoutModeChange(): Promise<void> {
    if (!this.breakoutMode || !this.selectedEvent || this.breakoutStudents.length > 0) {
      return;
    }

    this.loading = true;
    try {
      if (!this.coursesLoaded) {
        this.courses = await this.courseService.getAll();
        this.coursesLoaded = true;
      }
      this.breakoutStudents = this.flattenBreakouts(this.registrations);
      this.breakoutRows = this.buildBreakoutRows(this.breakoutStudents);
    } catch (err) {
      this.errorMessage = (err as { message?: string })?.message ?? 'Something went wrong loading breakout sign-ups.';
    } finally {
      this.loading = false;
    }
  }

  isGroupRow = (_: number, row: BreakoutRow): boolean => row.kind === 'breakout' || row.kind === 'session';
  isStudentRow = (_: number, row: BreakoutRow): boolean => row.kind === 'student';

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
      registrationDate: dateFromTimestamp(item.registrationDate),
      loggedIn: item.loggedIn ? 'Yes' : 'No',
      receipt: item.receipt ?? ''
    };
  }

  // Same join as event-breakouts.component.ts's own flatten(): trainingSessions
  // holds agenda-item ids, matched against this event's agendaItems for
  // session time, then that agenda item's `course` field matched against
  // the courses collection for the display name. A session pointing at an
  // agenda item or course that's since been deleted/renamed is skipped
  // rather than thrown on.
  private flattenBreakouts(registrations: EventRegistrationModel[]): BreakoutStudent[] {
    const agendaItems = this.selectedEvent?.agendaItems ?? [];
    const students: BreakoutStudent[] = [];

    registrations.forEach((reg) => {
      (reg.trainingSessions ?? []).forEach((session) => {
        const agendaItem = agendaItems.find((item) => item.id == session);
        const course = agendaItem ? this.courses.find((c) => c.id == agendaItem.course) : undefined;
        if (!agendaItem || !course) {
          return;
        }
        students.push({
          breakoutName: course.title,
          sessionDate: dateFromTimestamp(agendaItem.startDate),
          lastName: reg.lastName ?? '',
          firstName: reg.firstName ?? '',
          email: reg.email ?? ''
        });
      });
    });

    return students;
  }

  // Same 2-level grouping as event-breakouts.component.ts's own
  // buildRows() - breakout, then time-session within it, then students.
  private buildBreakoutRows(students: BreakoutStudent[]): BreakoutRow[] {
    const rows: BreakoutRow[] = [];

    const byBreakout = new Map<string, BreakoutStudent[]>();
    students.forEach((s) => {
      const list = byBreakout.get(s.breakoutName) ?? [];
      list.push(s);
      byBreakout.set(s.breakoutName, list);
    });

    Array.from(byBreakout.keys())
      .sort()
      .forEach((breakoutName) => {
        const breakoutStudents = byBreakout.get(breakoutName)!;
        rows.push({ kind: 'breakout', label: breakoutName, count: breakoutStudents.length });

        const bySession = new Map<string, BreakoutStudent[]>();
        breakoutStudents.forEach((s) => {
          const key = s.sessionDate ? s.sessionDate.toISOString() : '';
          const list = bySession.get(key) ?? [];
          list.push(s);
          bySession.set(key, list);
        });

        Array.from(bySession.keys())
          .sort()
          .forEach((key) => {
            const sessionStudents = bySession.get(key)!.sort((a, b) => a.lastName.localeCompare(b.lastName));
            const label = key ? new Date(key).toLocaleTimeString() : '';
            rows.push({ kind: 'session', label, count: sessionStudents.length });
            sessionStudents.forEach((s) => rows.push({ kind: 'student', lastName: s.lastName, firstName: s.firstName, email: s.email }));
          });
      });

    return rows;
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
