import { Component, Inject } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { AgendaItem } from '@impact-common/shared/models/domain/utils/agenda-item.model';
import { TrainingRoomModel } from '@impact-common/shared/models/domain/training-room.model';
import { CoachQuickCreateDialogComponent } from './coach-quick-create-dialog.component';
import { Instructor, SessionBlock, itemTitle } from './session-block.util';

export interface BreakoutBlockDialogData {
  block: SessionBlock | null;
  defaultStart: Date;
  // Combined Coaches + Impact Team, tagged with `source` for the grouped
  // picker - see event-agenda.component.ts's own comment.
  coaches: Instructor[];
  rooms: TrainingRoomModel[];
  // Every breakout item already on the event (all blocks) - feeds the
  // per-option "Copy from…" menu, so a breakout offered in two time slots
  // keeps an IDENTICAL title (the web schedule's "same session at another
  // time" check keys on normalized title equality post-Courses-retirement,
  // see the web repo's breakout.util.ts).
  existingBreakouts: AgendaItem[];
}

export interface BreakoutBlockDialogResult {
  action: 'save' | 'delete';
  // Ids the block started with, so the caller (event-agenda.component.ts)
  // can remove any option that got deleted/replaced from event.agendaItems
  // before splicing the returned `items` back in - a block isn't its own
  // stored entity (see session-block.util.ts's own comment), so there's no
  // single id for "the block" itself to key a replace off of.
  originalIds: string[];
  items: AgendaItem[];
}

// Authors one breakout block's several parallel options at once. 2026-08
// Courses retirement: each option is self-contained now - the admin types
// the breakout's Title (and optional Description) and picks its coach(es)
// directly, instead of linking a Course record. A breakout can still be
// offered in more than one block (morning and afternoon) - use "Copy
// from…" so both carry the identical title.
@Component({
    selector: 'app-breakout-block-dialog',
    templateUrl: './breakout-block-dialog.component.html',
    styleUrls: ['./breakout-block-dialog.component.scss'],
    standalone: false
})
export class BreakoutBlockDialogComponent {
  form: FormGroup;
  isEdit: boolean;

  private originalIds: string[];
  // Index-aligned with the `options` FormArray at all times (addOption
  // appends undefined, removeOption splices the same index) - preserves
  // each original item's legacy `course` provenance through a save.
  private originalItems: (AgendaItem | undefined)[];

  constructor(
    private dialogRef: MatDialogRef<BreakoutBlockDialogComponent, BreakoutBlockDialogResult>,
    @Inject(MAT_DIALOG_DATA) public data: BreakoutBlockDialogData,
    private fb: FormBuilder,
    private dialog: MatDialog
  ) {
    this.isEdit = !!data.block;
    this.originalIds = data.block?.options.map((o) => o.id!) ?? [];
    this.originalItems = data.block?.options.length ? [...data.block.options] : [undefined];

    const start = data.block?.startDate ?? data.defaultStart;
    const end = data.block?.endDate ?? new Date(start.getTime() + 60 * 60 * 1000);

    this.form = this.fb.group({
      startDate: [this.toInputValue(start), Validators.required],
      endDate: [this.toInputValue(end), Validators.required],
      options: this.fb.array((data.block?.options.length ? data.block.options : [null]).map((item) => this.optionGroup(item)))
    });
  }

  get options(): FormArray {
    return this.form.get('options') as FormArray;
  }

  private optionGroup(item: AgendaItem | null): FormGroup {
    return this.fb.group({
      id: [item?.id ?? null],
      text: [item?.text ?? '', Validators.required],
      description: [item?.description ?? ''],
      coaches: [item?.coaches ?? []],
      room: [item?.room ?? null],
      maxParticipants: [item?.maxParticipants ?? null]
    });
  }

  addOption(): void {
    this.options.push(this.optionGroup(null));
    this.originalItems.push(undefined);
  }

  removeOption(index: number): void {
    this.options.removeAt(index);
    this.originalItems.splice(index, 1);
  }

  coachGroups(): { label: string; coaches: Instructor[] }[] {
    return [
      { label: 'Impact Team', coaches: this.data.coaches.filter((c) => c.source === 'impact_team') },
      { label: 'Coaches', coaches: this.data.coaches.filter((c) => c.source !== 'impact_team') }
    ].filter((g) => g.coaches.length > 0);
  }

  // Distinct existing breakouts (by title) from anywhere on the event,
  // excluding the ones already in this block's own form.
  copySources(): AgendaItem[] {
    const inForm = new Set(
      (this.options.getRawValue() as { text: string }[]).map((o) => (o.text ?? '').trim().toLowerCase()).filter(Boolean)
    );
    const seen = new Set<string>();
    return (this.data.existingBreakouts ?? []).filter((item) => {
      const key = (item.text ?? '').trim().toLowerCase();
      if (!key || inForm.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  breakoutTitle(item: AgendaItem): string {
    return itemTitle(item);
  }

  copyInto(index: number, source: AgendaItem): void {
    this.options.at(index).patchValue({
      text: source.text ?? '',
      description: source.description ?? '',
      coaches: [...(source.coaches ?? [])]
    });
  }

  // "+ Add new coach to this event" - the slim quick-create is now the only
  // coach-creation path in the app (the Coaches screen is edit-only).
  addCoach(index: number): void {
    const ref = this.dialog.open(CoachQuickCreateDialogComponent, { width: '480px' });
    ref.afterClosed().subscribe((coach) => {
      if (!coach) {
        return;
      }
      this.data.coaches.push({ id: coach.id, fullname: coach.fullname, source: 'coaches' });
      const coaches = this.options.at(index).get('coaches');
      coaches?.setValue([...(coaches.value ?? []), coach.id]);
    });
  }

  onCancel(): void {
    this.dialogRef.close(undefined);
  }

  onDelete(): void {
    this.dialogRef.close({ action: 'delete', originalIds: this.originalIds, items: [] });
  }

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    const startDate = new Date(raw.startDate);
    const endDate = new Date(raw.endDate);

    // `null`, never `undefined` - see the identical fix + comment on
    // AgendaItemDialogComponent.onSave() for why: Firestore's setDoc()
    // rejects an explicit `undefined` anywhere in the document, and this
    // item only reaches Firestore later, batched into the whole Event
    // document.
    const items: AgendaItem[] = raw.options.map((opt: { id: string | null; text: string; description: string | null; coaches: string[]; room: string | null; maxParticipants: number | null }, index: number) => ({
      id: opt.id ?? this.generateId(),
      startDate,
      endDate,
      isCourse: true,
      isFoodBreak: false,
      text: opt.text,
      description: opt.description || null,
      coaches: opt.coaches ?? [],
      room: opt.room,
      maxParticipants: opt.maxParticipants ?? null,
      // LEGACY provenance carried through untouched (never newly set) -
      // see agenda-item.model.ts.
      course: this.originalItems[index]?.course ?? null
    }));

    this.dialogRef.close({ action: 'save', originalIds: this.originalIds, items });
  }

  private toInputValue(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  private generateId(): string {
    return 'xxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
