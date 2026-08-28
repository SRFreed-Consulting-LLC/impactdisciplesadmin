import { Component, EventEmitter, OnChanges, Output } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { AgendaHostComponent } from '../agenda-host.component';
import { AgendaItem } from '@impact-common/shared/models/domain/utils/agenda-item.model';
import { toMillis } from '@impact-common/shared/utils/date-from-timestamp';
import { blockLabel, dayKey, eventDayDates, groupAgendaItemsIntoBlocks, itemTitle, SessionBlock } from '../session-block.util';

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
export class AgendaWizardComponent extends AgendaHostComponent implements OnChanges {
  @Output() published = new EventEmitter<void>();

  step = 1;
  days: Date[] = [];
  blockLabel = blockLabel;

  constructor(dialog: MatDialog) {
    super(dialog);
  }

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

}
