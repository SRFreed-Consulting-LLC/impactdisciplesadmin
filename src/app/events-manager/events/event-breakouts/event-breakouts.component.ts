import { Component, Input, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, of } from 'rxjs';
import { CourseModel } from 'src/app/common/models/domain/course.model';
import { EventModel } from 'src/app/common/models/domain/event.model';
import { CourseService } from 'src/app/common/services/data/course.service';
import { EventRegistrationService } from 'src/app/common/services/data/event-registration.service';
import { ColumnFilterValue, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../../shared/column-filter/column-filter.model';

export class BreakOutStudent {
  id: string;
  breakoutId: string;
  breakoutName: string;
  startDate: Date;
  firstName: string;
  lastName: string;
  email: string;
}

// Rows synthesized for the mat-table - matColumnDef/matRowDef "when"
// predicates pick a different row template per kind, standing in for
// DevExtreme's native two-level dxo-grouping (groupIndex 0/1) + group
// summary counts, neither of which mat-table has built in.
type BreakoutRow =
  | { kind: 'breakout'; label: string; count: number }
  | { kind: 'session'; label: string; count: number }
  | { kind: 'student'; firstName: string; lastName: string; email: string };

@Component({
    selector: 'app-event-breakouts',
    templateUrl: './event-breakouts.component.html',
    styleUrls: ['./event-breakouts.component.scss'],
    standalone: false
})
export class EventBreakoutsComponent implements OnInit {
  @Input() event: EventModel;

  rows$: Observable<BreakoutRow[]>;
  totalRegistered$: Observable<number>;
  textOperators = TEXT_FILTER_OPERATORS;

  courses: CourseModel[] = [];

  private filter$ = new BehaviorSubject<ColumnFilterValue | undefined>(undefined);

  constructor(public service: EventRegistrationService, private courseService: CourseService) {}

  async ngOnInit(): Promise<void> {
    this.courses = await this.courseService.getAll();

    const students$: Observable<BreakOutStudent[]> = this.event?.id
      ? this.service.streamAllByValue('eventId', this.event.id).pipe(map((customers) => this.flatten(customers)))
      : of([]);

    const filtered$ = combineLatest([students$, this.filter$]).pipe(
      map(([students, filter]) =>
        students.filter(
          (s) =>
            matchesColumnFilter(s.firstName, filter, 'text') ||
            matchesColumnFilter(s.lastName, filter, 'text') ||
            matchesColumnFilter(s.email, filter, 'text')
        )
      )
    );

    this.rows$ = filtered$.pipe(map((students) => this.buildRows(students)));
    this.totalRegistered$ = filtered$.pipe(map((students) => students.length));
  }

  onFilterChange(filter: ColumnFilterValue): void {
    this.filter$.next(filter);
  }

  isGroupRow = (_: number, row: BreakoutRow): boolean => row.kind === 'breakout' || row.kind === 'session';
  isStudentRow = (_: number, row: BreakoutRow): boolean => row.kind === 'student';

  // customer.trainingSessions holds agenda-item ids; each is looked up
  // against event.agendaItems, then that agenda item's `course` field is
  // looked up against the Courses list - a session pointing at an agenda
  // item or course that's since been deleted/renamed is skipped rather
  // than thrown on (the original dereferenced both unconditionally).
  private flatten(customers: { firstName: string; lastName: string; email: string; trainingSessions?: string[] }[]): BreakOutStudent[] {
    const agendaItems = this.event?.agendaItems ?? [];
    const students: BreakOutStudent[] = [];

    customers.forEach((customer) => {
      customer.trainingSessions?.forEach((session) => {
        const agendaItem = agendaItems.find((item) => item.id == session);
        const course = agendaItem ? this.courses.find((c) => c.id == agendaItem.course) : undefined;
        if (!agendaItem || !course) {
          return;
        }

        students.push({
          id: customer.email + session,
          breakoutId: session,
          breakoutName: course.title,
          startDate: agendaItem.startDate,
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: customer.email
        });
      });
    });

    return students;
  }

  private buildRows(students: BreakOutStudent[]): BreakoutRow[] {
    const rows: BreakoutRow[] = [];

    const byBreakout = new Map<string, BreakOutStudent[]>();
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

        const bySession = new Map<string, BreakOutStudent[]>();
        breakoutStudents.forEach((s) => {
          const key = s.startDate ? new Date(s.startDate).toISOString() : '';
          const list = bySession.get(key) ?? [];
          list.push(s);
          bySession.set(key, list);
        });

        Array.from(bySession.keys())
          .sort()
          .forEach((key) => {
            const sessionStudents = bySession.get(key)!.sort((a, b) => (a.lastName ?? '').localeCompare(b.lastName ?? ''));
            const label = key ? new Date(key).toLocaleTimeString() : '';
            rows.push({ kind: 'session', label, count: sessionStudents.length });
            sessionStudents.forEach((s) => rows.push({ kind: 'student', firstName: s.firstName, lastName: s.lastName, email: s.email }));
          });
      });

    return rows;
  }
}
