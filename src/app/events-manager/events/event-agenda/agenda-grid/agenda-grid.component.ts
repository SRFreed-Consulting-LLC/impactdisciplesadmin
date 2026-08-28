import { Component, OnChanges } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { AgendaHostComponent } from '../agenda-host.component';
import { AgendaItem } from '@impact-common/shared/models/domain/utils/agenda-item.model';
import { TrainingRoomModel } from '@impact-common/shared/models/domain/training-room.model';
import { toMillis } from '@impact-common/shared/utils/date-from-timestamp';
import { buildDaySchedule, coachLabelFor, DayScheduleEntry, dayKey, eventDayDates, itemTitle, SessionBlock } from '../session-block.util';

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
export class AgendaGridComponent extends AgendaHostComponent implements OnChanges {
  // Canvas and Grid both track a selected day; the base uses it as the
  // default for a newly created item or block.
  protected override hostDay(): Date | null {
    return this.selectedDay ?? null;
  }


  days: Date[] = [];
  selectedDayIndex = 0;

  constructor(dialog: MatDialog) {
    super(dialog);
  }

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

  titleFor(item: AgendaItem): string {
    return itemTitle(item);
  }

  coachLabel(option: AgendaItem): string {
    return coachLabelFor(option, this.coaches);
  }

}
