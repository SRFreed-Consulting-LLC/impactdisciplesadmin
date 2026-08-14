import { Component, Input, OnChanges } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { EventModel } from 'src/app/common/models/domain/event.model';
import { AgendaItem } from 'src/app/common/models/domain/utils/agenda-item.model';
import { CourseModel } from 'src/app/common/models/domain/course.model';
import { CoachModel } from 'src/app/common/models/domain/coach.model';
import { TrainingRoomModel } from 'src/app/common/models/domain/training-room.model';
import { toMillis } from 'src/app/common/utils/date-from-timestamp';
import { AgendaItemDialogComponent, AgendaItemDialogResult } from '../agenda-item-dialog.component';
import { BreakoutBlockDialogComponent, BreakoutBlockDialogResult } from '../breakout-block-dialog.component';
import { buildDaySchedule, coachLabelFor, DayScheduleEntry, dayKey, eventDayDates, SessionBlock } from '../session-block.util';

// Fine-tune view (option 2 of 2, see agenda-canvas.component.ts for the
// other) - a conference-program-style grid, time down the side, rooms
// across the top, so a room double-booked at the same time is impossible
// to miss. Columns are the rooms actually in use anywhere on this event
// (falling back to every room at the event's location if none are in use
// yet) rather than every room at the location unconditionally, so a large
// venue with rooms this event isn't using doesn't leave the grid mostly
// empty columns.
@Component({
    selector: 'app-agenda-grid',
    templateUrl: './agenda-grid.component.html',
    styleUrls: ['./agenda-grid.component.scss'],
    standalone: false
})
export class AgendaGridComponent implements OnChanges {
  @Input() event: EventModel;
  @Input() courses: CourseModel[] = [];
  @Input() coaches: CoachModel[] = [];
  @Input() rooms: TrainingRoomModel[] = [];

  days: Date[] = [];
  selectedDayIndex = 0;

  constructor(private dialog: MatDialog) {}

  ngOnChanges(): void {
    this.days = eventDayDates(this.event?.startDate, this.event?.endDate);
    if (this.selectedDayIndex >= this.days.length) {
      this.selectedDayIndex = 0;
    }
  }

  get selectedDay(): Date | undefined {
    return this.days[this.selectedDayIndex];
  }

  gridRooms(): TrainingRoomModel[] {
    const usedIds = new Set(
      (this.event.agendaItems ?? []).filter((item) => item.isCourse && item.room).map((item) => item.room as string)
    );
    const used = this.rooms.filter((r) => usedIds.has(r.id!));
    return used.length ? used : this.rooms;
  }

  schedule(): DayScheduleEntry[] {
    const day = this.selectedDay;
    if (!day) return [];
    const key = dayKey(day);
    const items = (this.event.agendaItems ?? []).filter((item) => {
      const ms = toMillis(item.startDate);
      return ms > 0 && dayKey(new Date(ms)) === key;
    });
    return buildDaySchedule(items);
  }

  optionForRoom(block: SessionBlock, roomId: string | undefined): AgendaItem | undefined {
    return block.options.find((o) => o.room === roomId);
  }

  courseTitle(courseId: string | undefined): string {
    return this.courses.find((c) => c.id === courseId)?.title ?? '(Course)';
  }

  coachLabel(option: AgendaItem): string {
    return coachLabelFor(option, this.courses.find((c) => c.id === option.course), this.coaches);
  }

  openItemDialog(item: AgendaItem | null): void {
    const day = this.selectedDay ?? new Date();
    const defaultStart = item ? new Date(toMillis(item.startDate)) : new Date(day.getTime() + 9 * 60 * 60 * 1000);
    const ref = this.dialog.open<AgendaItemDialogComponent, unknown, AgendaItemDialogResult>(AgendaItemDialogComponent, {
      width: '600px',
      maxWidth: '95vw',
      data: { item, defaultStart, courses: this.courses, coaches: this.coaches, rooms: this.rooms }
    });
    ref.afterClosed().subscribe((result) => this.applyItemResult(result));
  }

  openBlockDialog(block: SessionBlock | null): void {
    const day = this.selectedDay ?? new Date();
    const defaultStart = block ? block.startDate : new Date(day.getTime() + 10 * 60 * 60 * 1000);
    const ref = this.dialog.open<BreakoutBlockDialogComponent, unknown, BreakoutBlockDialogResult>(BreakoutBlockDialogComponent, {
      width: '820px',
      maxWidth: '95vw',
      data: { block, defaultStart, courses: this.courses, coaches: this.coaches, rooms: this.rooms }
    });
    ref.afterClosed().subscribe((result) => this.applyBlockResult(result));
  }

  private applyItemResult(result: AgendaItemDialogResult | undefined): void {
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
  }

  private applyBlockResult(result: BreakoutBlockDialogResult | undefined): void {
    if (!result) return;
    const items = this.event.agendaItems ?? (this.event.agendaItems = []);
    result.originalIds.forEach((id) => {
      const index = items.findIndex((i) => i.id === id);
      if (index >= 0) items.splice(index, 1);
    });
    items.push(...result.items);
  }
}
