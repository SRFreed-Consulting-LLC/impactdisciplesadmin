import { Component, Inject } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { AgendaItem } from 'src/app/common/models/domain/utils/agenda-item.model';
import { CourseModel } from 'src/app/common/models/domain/course.model';
import { CoachModel } from 'src/app/common/models/domain/coach.model';
import { TrainingRoomModel } from 'src/app/common/models/domain/training-room.model';
import { SessionBlock, coachLabelFor } from './session-block.util';

export interface BreakoutBlockDialogData {
  block: SessionBlock | null;
  defaultStart: Date;
  courses: CourseModel[];
  coaches: CoachModel[];
  rooms: TrainingRoomModel[];
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

// Authors one breakout block's several parallel options at once - Course
// and Room dropdowns match the exact same data-source convention as the
// existing single-item AgendaItemDialogComponent (data.courses/data.rooms,
// already loaded by the parent, same plain-array-via-@for pattern). Coach
// is read-only here, resolved from the selected course - see CourseModel's
// own comment on coachIds for why a breakout option no longer picks its
// own coach independently. A course can be scheduled into more than one
// block (e.g. offered both morning and afternoon) - nothing here dedupes
// or restricts the Course dropdown based on where else it's used.
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
  // appends undefined, removeOption splices the same index) - lets
  // coachLabel() fall back to a legacy option's own `coaches` when its
  // course has no coachIds set yet, via the shared coachLabelFor() rather
  // than re-deriving that fallback rule here.
  private originalItems: (AgendaItem | undefined)[];

  constructor(
    private dialogRef: MatDialogRef<BreakoutBlockDialogComponent, BreakoutBlockDialogResult>,
    @Inject(MAT_DIALOG_DATA) public data: BreakoutBlockDialogData,
    private fb: FormBuilder
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
      course: [item?.course ?? null, Validators.required],
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

  courseFor(courseId: string | null): CourseModel | undefined {
    return this.data.courses.find((c) => c.id === courseId);
  }

  coachLabel(index: number, courseId: string | null): string {
    const course = this.courseFor(courseId);
    const fallbackItem = this.originalItems[index] ?? ({ coaches: [] } as unknown as AgendaItem);
    return coachLabelFor(fallbackItem, course, this.data.coaches);
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
    // AgendaItemDialogComponent.onSave() (agenda-item-dialog.component.ts)
    // for why: Firestore's setDoc() rejects an explicit `undefined`
    // anywhere in the document, and this item only reaches Firestore
    // later, batched into the whole Event document.
    const items: AgendaItem[] = raw.options.map((opt: { id: string | null; course: string; room: string | null; maxParticipants: number | null }) => ({
      id: opt.id ?? this.generateId(),
      startDate,
      endDate,
      isCourse: true,
      isFoodBreak: false,
      course: opt.course,
      room: opt.room,
      maxParticipants: opt.maxParticipants ?? null,
      text: null,
      description: null
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
