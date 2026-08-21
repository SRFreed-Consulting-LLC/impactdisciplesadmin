import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { EventModel } from '@impact-common/shared/models/domain/event.model';
import { AgendaItem } from '@impact-common/shared/models/domain/utils/agenda-item.model';
import { TrainingRoomModel } from '@impact-common/shared/models/domain/training-room.model';
import { toMillis } from '@impact-common/shared/utils/date-from-timestamp';
import { AgendaItemDialogComponent, AgendaItemDialogResult } from '../agenda-item-dialog.component';
import { BreakoutBlockDialogComponent, BreakoutBlockDialogResult } from '../breakout-block-dialog.component';
import { blockLabel, dayKey, eventDayDates, groupAgendaItemsIntoBlocks, Instructor, itemTitle, SessionBlock } from '../session-block.util';

// Step 1 of the redesigned Agenda tab (see event-agenda.component.ts) - a
// once-a-year guided pass for building a Summit's skeleton: Days & Rooms
// (informational - Location/Rooms are configured elsewhere, this just
// confirms what's available), Single Items, Breakout Blocks, then Review
// & Publish, which hands off to Canvas/Grid for ongoing fine-tuning
// (published output, handled by the parent shell). Both single items and
// blocks are edited via dialogs that mutate `event.agendaItems` directly,
// same in-place-mutation pattern the old calendar-only Agenda tab already
// used - nothing here persists to Firestore on its own, that still only
// happens when the Info tab's Save is clicked (events.component.ts).
@Component({
    selector: 'app-agenda-wizard',
    templateUrl: './agenda-wizard.component.html',
    styleUrls: ['./agenda-wizard.component.scss'],
    standalone: false
})
export class AgendaWizardComponent implements OnChanges {
  @Input() event: EventModel;
  @Input() coaches: Instructor[] = [];
  @Input() rooms: TrainingRoomModel[] = [];
  @Output() published = new EventEmitter<void>();

  step = 1;
  days: Date[] = [];
  blockLabel = blockLabel;

  constructor(private dialog: MatDialog) {}

  ngOnChanges(): void {
    this.days = eventDayDates(this.event?.startDate, this.event?.endDate);
  }

  goToStep(n: number): void {
    this.step = n;
  }

  next(): void {
    if (this.step < 4) {
      this.step++;
    } else {
      this.published.emit();
    }
  }

  back(): void {
    if (this.step > 1) this.step--;
  }

  itemsForDay(day: Date): AgendaItem[] {
    const key = dayKey(day);
    return (this.event.agendaItems ?? []).filter((item) => {
      const ms = toMillis(item.startDate);
      return ms > 0 && dayKey(new Date(ms)) === key;
    });
  }

  singleItemsForDay(day: Date): AgendaItem[] {
    return this.itemsForDay(day)
      .filter((item) => !item.isCourse)
      .sort((a, b) => toMillis(a.startDate) - toMillis(b.startDate));
  }

  blocksForDay(day: Date): SessionBlock[] {
    return groupAgendaItemsIntoBlocks(this.itemsForDay(day));
  }

  totalSingleItems(): number {
    return (this.event.agendaItems ?? []).filter((item) => !item.isCourse).length;
  }

  totalBlocks(): number {
    return this.days.reduce((sum, day) => sum + this.blocksForDay(day).length, 0);
  }

  totalOptions(): number {
    return (this.event.agendaItems ?? []).filter((item) => item.isCourse).length;
  }

  titleFor(item: AgendaItem): string {
    return itemTitle(item);
  }

  roomName(roomId: string | undefined): string {
    return this.rooms.find((r) => r.id === roomId)?.name ?? '—';
  }

  openItemDialog(item: AgendaItem | null, day: Date): void {
    const defaultStart = item ? new Date(toMillis(item.startDate)) : new Date(day.getTime() + 9 * 60 * 60 * 1000);
    const ref = this.dialog.open<AgendaItemDialogComponent, unknown, AgendaItemDialogResult>(AgendaItemDialogComponent, {
      width: '600px',
      maxWidth: '95vw',
      data: { item, defaultStart, coaches: this.coaches, rooms: this.rooms }
    });
    ref.afterClosed().subscribe((result) => this.applyItemResult(result));
  }

  openBlockDialog(block: SessionBlock | null, day: Date): void {
    const defaultStart = block ? block.startDate : new Date(day.getTime() + 10 * 60 * 60 * 1000);
    // Full-screen - see breakout-block-dialog.component.scss's own comment.
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
