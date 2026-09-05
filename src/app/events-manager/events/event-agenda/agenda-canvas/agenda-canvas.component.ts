import { Component, OnChanges } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { AgendaHostComponent } from '../agenda-host.component';
import { AgendaItem } from '@impact-common/shared/models/domain/utils/agenda-item.model';
import { toMillis } from '@impact-common/shared/utils/date-from-timestamp';
import { blockLabel, buildDaySchedule, coachLabelFor, DayScheduleEntry, dayKey, eventDayDates, itemTitle, SessionBlock } from '../session-block.util';

// Fine-tune view (option 1 of 2, see agenda-grid.component.ts for the
// other) - a day's single items and breakout blocks rendered as one
// chronological list of cards, blocks expandable to show their parallel
// options. This is where an admin lands after the Wizard's Publish step,
// or immediately on opening an existing Summit event that already has
// agenda items - see event-agenda.component.ts's own mode-choosing logic.
@Component({
    selector: 'app-agenda-canvas',
    templateUrl: './agenda-canvas.component.html',
    styleUrls: ['./agenda-canvas.component.scss'],
    standalone: false
})
export class AgendaCanvasComponent extends AgendaHostComponent implements OnChanges {
  // Canvas and Grid both track a selected day; the base uses it as the
  // default for a newly created item or block.
  protected override hostDay(): Date | null {
    return this.selectedDay ?? null;
  }


  days: Date[] = [];
  selectedDayIndex = 0;
  blockLabel = blockLabel;

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

  blockIndex(block: SessionBlock): number {
    return this.schedule()
      .filter((entry): entry is { kind: 'block'; block: SessionBlock } => entry.kind === 'block')
      .findIndex((entry) => entry.block.key === block.key);
  }

  titleFor(item: AgendaItem): string {
    return itemTitle(item);
  }

  roomName(roomId: string | null | undefined): string {
    return this.rooms.find((r) => r.id === roomId)?.name ?? '—';
  }

  coachLabel(option: AgendaItem): string {
    return coachLabelFor(option, this.coaches);
  }

}
