import { Component, Input, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { CalendarEvent, CalendarEventTimesChangedEvent, CalendarView } from 'angular-calendar';
import { EventColor } from 'calendar-utils';
import { EventModel } from 'impactdisciplescommon/src/models/domain/event.model';
import { AgendaItem } from 'impactdisciplescommon/src/models/domain/utils/agenda-item.model';
import { CourseModel } from 'impactdisciplescommon/src/models/domain/course.model';
import { CoachModel } from 'impactdisciplescommon/src/models/domain/coach.model';
import { TrainingRoomModel } from 'impactdisciplescommon/src/models/domain/training-room.model';
import { CoachService } from 'impactdisciplescommon/src/services/data/coach.service';
import { CourseService } from 'impactdisciplescommon/src/services/data/course.service';
import { LocationService } from 'impactdisciplescommon/src/services/data/location.service';
import { dateFromTimestamp } from 'impactdisciplescommon/src/utils/date-from-timestamp';
import { AgendaItemDialogComponent, AgendaItemDialogResult } from './agenda-item-dialog.component';

// Replaces DevExtreme's dx-scheduler. Deliberate, documented deviations
// from the original (see the Events Manager migration plan):
// - daysInWeek:3 replicates the original's fixed 3-day rolling window
//   exactly (angular-calendar's week view supports this directly).
// - Drag-to-move and resize-to-change-duration are native to the week
//   view; drag-to-create-on-empty-space is not, so an explicit "+ Add
//   Agenda Item" button (and clicking an empty hour segment) opens the
//   same edit dialog instead.
// - No true swim-lanes per resource (course/coach/room) - the original's
//   3 dxi-resource axes with no `groups` set never actually rendered as
//   lanes either, just per-course coloring, which this replicates by
//   hashing each course id to a color from a fixed palette.
const COURSE_COLORS: EventColor[] = [
  { primary: '#1e88e5', secondary: '#e3f2fd' },
  { primary: '#43a047', secondary: '#e8f5e9' },
  { primary: '#fb8c00', secondary: '#fff3e0' },
  { primary: '#8e24aa', secondary: '#f3e5f5' },
  { primary: '#00897b', secondary: '#e0f2f1' },
  { primary: '#d81b60', secondary: '#fce4ec' },
  { primary: '#3949ab', secondary: '#e8eaf6' }
];
const FOOD_BREAK_COLOR: EventColor = { primary: '#6d4c41', secondary: '#efebe9' };
const AGENDA_COLOR: EventColor = { primary: '#546e7a', secondary: '#eceff1' };

@Component({
    selector: 'app-event-agenda',
    templateUrl: './event-agenda.component.html',
    styleUrls: ['./event-agenda.component.scss'],
    standalone: false
})
export class EventAgendaComponent implements OnInit {
  @Input('event') event: EventModel;

  CalendarView = CalendarView;
  view: CalendarView = CalendarView.Week;
  viewDate = new Date();
  events: CalendarEvent<AgendaItem>[] = [];

  courses: CourseModel[] = [];
  coaches: CoachModel[] = [];
  rooms: TrainingRoomModel[] = [];

  constructor(
    private courseService: CourseService,
    private coachService: CoachService,
    private locationService: LocationService,
    private dialog: MatDialog
  ) {}

  async ngOnInit(): Promise<void> {
    if (!this.event.agendaItems) {
      this.event.agendaItems = [];
    }
    this.viewDate = this.toValidDate(dateFromTimestamp(this.event.startDate)) ?? new Date();

    this.courses = await this.courseService.getAll();
    this.coaches = await this.coachService.getAll();

    const locationId = typeof this.event.location === 'string' ? this.event.location : this.event.location?.id;
    this.rooms = locationId ? ((await this.locationService.getById(locationId))?.trainingrooms ?? []) : [];

    this.rebuildEvents();
  }

  // dateFromTimestamp() has a known, pre-existing gap (see its own
  // comment): a date already stored in Firestore as a plain string in an
  // unrecognized format is returned unchanged rather than parsed - a real
  // data-quality artifact from the original DevExtreme date box's
  // dateSerializationFormat writing some dates back as strings instead of
  // Timestamps. Coerces whatever comes back into a real Date (or null),
  // matching the same defensiveness events.component.ts's own
  // toInputValue() already applies.
  private toValidDate(value: unknown): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value as string);
    return isNaN(date.getTime()) ? null : date;
  }

  private rebuildEvents(): void {
    this.events = (this.event.agendaItems ?? []).map((item) => this.toCalendarEvent(item));
  }

  private toCalendarEvent(item: AgendaItem): CalendarEvent<AgendaItem> {
    return {
      id: item.id,
      start: new Date(item.startDate),
      end: item.endDate ? new Date(item.endDate) : undefined,
      title: this.titleFor(item),
      color: this.colorFor(item),
      meta: item,
      resizable: { beforeStart: true, afterEnd: true },
      draggable: true
    };
  }

  titleFor(item: AgendaItem): string {
    if (item.isCourse) {
      return this.getCourseById(item.course)?.title ?? '(Course)';
    }
    return item.text || '(Untitled)';
  }

  private colorFor(item: AgendaItem): EventColor {
    if (item.isFoodBreak) return FOOD_BREAK_COLOR;
    if (item.isCourse && item.course) {
      const index = this.courses.findIndex((c) => c.id === item.course);
      return COURSE_COLORS[Math.max(index, 0) % COURSE_COLORS.length];
    }
    return AGENDA_COLOR;
  }

  getCourseById = (id: string | undefined): CourseModel | undefined => this.courses.find((c) => c.id === id);
  getCoachById = (id: string): CoachModel | undefined => this.coaches.find((c) => c.id === id);

  onEventClicked({ event }: { event: CalendarEvent<AgendaItem> }): void {
    this.openDialog(event.meta ?? null, event.start);
  }

  onEventTimesChanged({ event, newStart, newEnd }: CalendarEventTimesChangedEvent<AgendaItem>): void {
    const item = event.meta;
    if (!item) return;

    item.startDate = newStart;
    if (newEnd) {
      item.endDate = newEnd;
    }
    this.rebuildEvents();
  }

  openDialog(item: AgendaItem | null, defaultStart: Date): void {
    const ref = this.dialog.open<AgendaItemDialogComponent, unknown, AgendaItemDialogResult>(AgendaItemDialogComponent, {
      width: '600px',
      maxWidth: '95vw',
      data: { item, defaultStart, courses: this.courses, coaches: this.coaches, rooms: this.rooms }
    });

    ref.afterClosed().subscribe((result) => {
      if (!result) return;

      const items = this.event.agendaItems ?? (this.event.agendaItems = []);
      const index = items.findIndex((i) => i.id === result.item.id);

      if (result.action === 'delete') {
        if (index >= 0) items.splice(index, 1);
      } else if (index >= 0) {
        items[index] = result.item;
      } else {
        items.push(result.item);
      }

      this.rebuildEvents();
    });
  }
}
