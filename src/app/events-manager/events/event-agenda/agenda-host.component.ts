import { Directive, Input } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { EventModel } from '@impact-common/shared/models/domain/event.model';
import { AgendaItem } from '@impact-common/shared/models/domain/utils/agenda-item.model';
import { TrainingRoomModel } from '@impact-common/shared/models/domain/training-room.model';
import { toMillis } from '@impact-common/shared/utils/date-from-timestamp';
import {
  AgendaItemDialogComponent,
  AgendaItemDialogResult,
} from './agenda-item-dialog.component';
import {
  BreakoutBlockDialogComponent,
  BreakoutBlockDialogResult,
} from './breakout-block-dialog.component';
import { Instructor, SessionBlock } from './session-block.util';

/**
 * What the three agenda editing surfaces - Canvas, Grid and the Setup
 * Wizard - have in common: opening the item/block dialogs and folding their
 * results back into `event.agendaItems`.
 *
 * Two deliberate VIEWS of one agenda is fine and documented ("option 1 of 2"
 * / "option 2 of 2"). Three copies of the MUTATION logic was not
 * (2026-08-27 sweep, P3): openItemDialog, openBlockDialog, applyItemResult,
 * applyBlockResult and the 12-line full-screen dialog config were identical
 * in all three, and AgendaItemDialogResult/BreakoutBlockDialogResult are a
 * contract between the dialogs and their hosts - so changing either shape
 * needed three synchronised edits, and missing one produced a view where an
 * agenda edit silently did not stick.
 *
 * The drift had already started: Canvas carried the full four-line
 * explanation of why the block dialog is full-screen, while Grid and Wizard
 * had shortened it to a one-line stub pointing at a file. That explanation
 * now has one home, below.
 */
@Directive()
export abstract class AgendaHostComponent {
  @Input() event!: EventModel;
  @Input() coaches: Instructor[] = [];
  @Input() rooms: TrainingRoomModel[] = [];

  constructor(protected dialog: MatDialog) {}

  /**
   * The day a newly-created item should default to.
   *
   * Canvas and Grid have a selected day and override this; the Wizard edits
   * several days at once and passes the day in explicitly instead, which is
   * why every method below takes an optional `day` that wins over this.
   * A METHOD rather than a getter: a getter returning a literal trips
   * @typescript-eslint/class-literal-property-style, and subclasses override
   * either shape equally well.
   * @return {Date | null} The day, or null when the host has no notion of one.
   */
  protected hostDay(): Date | null {
    return null;
  }

  private dayFor(day?: Date): Date {
    return day ?? this.hostDay() ?? new Date();
  }

  /**
   * Opens the single-item dialog and applies whatever comes back.
   * @param {AgendaItem | null} item The item to edit, or null to create.
   * @param {Date} [day] The day to default a new item onto. Wizard passes
   *   this; Canvas and Grid rely on hostDay.
   */
  openItemDialog(item: AgendaItem | null, day?: Date): void {
    const on = this.dayFor(day);
    const defaultStart = item ?
      new Date(toMillis(item.startDate)) :
      new Date(on.getTime() + 9 * 60 * 60 * 1000);

    this.dialog.open<AgendaItemDialogComponent, unknown, AgendaItemDialogResult>(
      AgendaItemDialogComponent,
      {
        width: '600px',
        maxWidth: '95vw',
        data: {item: item, defaultStart, coaches: this.coaches, rooms: this.rooms},
      }
    ).afterClosed().subscribe((result) => this.applyItemResult(result));
  }

  /**
   * Opens the breakout-block dialog and applies whatever comes back.
   *
   * FULL-SCREEN, not the usual capped-width popup - see
   * breakout-block-dialog.component.scss's own comment on why: its
   * Course/Coach/Room/Max options table needs real width to stay aligned as
   * a table instead of collapsing into a cramped flex row.
   * @param {SessionBlock | null} block The block to edit, or null to create.
   * @param {Date} [day] The day to default a new block onto.
   */
  openBlockDialog(block: SessionBlock | null, day?: Date): void {
    const on = this.dayFor(day);
    const defaultStart = block ?
      block.startDate :
      new Date(on.getTime() + 10 * 60 * 60 * 1000);

    this.dialog.open<
      BreakoutBlockDialogComponent, unknown, BreakoutBlockDialogResult
    >(BreakoutBlockDialogComponent, {
      width: '100vw',
      maxWidth: '100vw',
      height: '100vh',
      maxHeight: '100vh',
      panelClass: 'breakout-block-dialog-panel',
      data: {
        block,
        defaultStart,
        coaches: this.coaches,
        rooms: this.rooms,
        existingBreakouts: (this.event.agendaItems ?? []).filter((i) => i.isCourse),
      },
    }).afterClosed().subscribe((result) => this.applyBlockResult(result));
  }

  /** Adds, replaces or removes one item, in place on event.agendaItems. */
  protected applyItemResult(result: AgendaItemDialogResult | undefined): void {
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

  /**
   * Replaces a whole breakout block: every option the dialog started with is
   * removed by id, then whatever it returned is added.
   *
   * Keyed on originalIds rather than on the returned items because a block
   * edit can add, remove AND rename options in one go.
   */
  protected applyBlockResult(result: BreakoutBlockDialogResult | undefined): void {
    if (!result) return;
    const items = this.event.agendaItems ?? (this.event.agendaItems = []);
    result.originalIds.forEach((id) => {
      const index = items.findIndex((i) => i.id === id);
      if (index >= 0) items.splice(index, 1);
    });
    items.push(...result.items);
  }
}
