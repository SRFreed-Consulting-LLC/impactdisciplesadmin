import { Component, Input, OnChanges } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { EventModel } from '@impact-common/shared/models/domain/event.model';
import { AgendaItem } from '@impact-common/shared/models/domain/utils/agenda-item.model';
import { TrainingRoomModel } from '@impact-common/shared/models/domain/training-room.model';
import { toMillis } from '@impact-common/shared/utils/date-from-timestamp';
import { AgendaItemDialogComponent, AgendaItemDialogResult } from '../agenda-item-dialog.component';
import { BreakoutBlockDialogComponent, BreakoutBlockDialogResult } from '../breakout-block-dialog.component';
import { blockLabel, buildDaySchedule, coachLabelFor, DayScheduleEntry, dayKey, eventDayDates, Instructor, itemTitle, SessionBlock } from '../session-block.util';

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
export class AgendaCanvasComponent implements OnChanges {
  @Input() event: EventModel;
  @Input() coaches: Instructor[] = [];
  @Input() rooms: TrainingRoomModel[] = [];

  days: Date[] = [];
  selectedDayIndex = 0;
  blockLabel = blockLabel;

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

  roomName(roomId: string | undefined): string {
    return this.rooms.find((r) => r.id === roomId)?.name ?? '—';
  }

  coachLabel(option: AgendaItem): string {
    return coachLabelFor(option, this.coaches);
  }

  openItemDialog(item: AgendaItem | null): void {
    const day = this.selectedDay ?? new Date();
    const defaultStart = item ? new Date(toMillis(item.startDate)) : new Date(day.getTime() + 9 * 60 * 60 * 1000);
    const ref = this.dialog.open<AgendaItemDialogComponent, unknown, AgendaItemDialogResult>(AgendaItemDialogComponent, {
      width: '600px',
      maxWidth: '95vw',
      data: { item, defaultStart, coaches: this.coaches, rooms: this.rooms }
    });
    ref.afterClosed().subscribe((result) => this.applyItemResult(result));
  }

  openBlockDialog(block: SessionBlock | null): void {
    const day = this.selectedDay ?? new Date();
    const defaultStart = block ? block.startDate : new Date(day.getTime() + 10 * 60 * 60 * 1000);
    // Full-screen (not the usual capped-width popup) - see
    // breakout-block-dialog.component.scss's own comment on why: its
    // Course/Coach/Room/Max options table needs real width to stay
    // aligned as a table instead of a cramped flex row.
    const ref = this.dialog.open<BreakoutBlockDialogComponent, unknown, BreakoutBlockDialogResult>(BreakoutBlockDialogComponent, {
      width: '100vw',
      maxWidth: '100vw',
      height: '100vh',
      maxHeight: '100vh',
      panelClass: 'breakout-block-dialog-panel',
      data: { block, defaultStart, coaches: this.coaches, rooms: this.rooms, existingBreakouts: (this.event.agendaItems ?? []).filter((i) => i.isCourse) }
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
