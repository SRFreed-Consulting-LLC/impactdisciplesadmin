import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { AgendaItem } from 'src/app/common/models/domain/utils/agenda-item.model';
import { CourseModel } from 'src/app/common/models/domain/course.model';
import { CoachModel } from 'src/app/common/models/domain/coach.model';
import { TrainingRoomModel } from 'src/app/common/models/domain/training-room.model';

export interface AgendaItemDialogData {
  item: AgendaItem | null;
  defaultStart: Date;
  courses: CourseModel[];
  coaches: CoachModel[];
  rooms: TrainingRoomModel[];
}

export interface AgendaItemDialogResult {
  action: 'save' | 'delete';
  item: AgendaItem;
}

type AgendaItemType = 'course' | 'foodBreak' | 'agenda';

// Replaces the original's imperative, self-reconfiguring dx-form (three
// different item arrays swapped into form.option().items depending on
// isCourse/isFoodBreak switches, followed by form.repaint()) with a single
// reactive form + a Type select that conditionally reveals the matching
// fields - the same practical 3-way editing behavior, but declarative.
@Component({
    selector: 'app-agenda-item-dialog',
    templateUrl: './agenda-item-dialog.component.html',
    styleUrls: ['./agenda-item-dialog.component.scss'],
    standalone: false
})
export class AgendaItemDialogComponent {
  form: FormGroup;
  isEdit: boolean;

  constructor(
    private dialogRef: MatDialogRef<AgendaItemDialogComponent, AgendaItemDialogResult>,
    @Inject(MAT_DIALOG_DATA) public data: AgendaItemDialogData,
    private fb: FormBuilder
  ) {
    this.isEdit = !!data.item;

    const item = data.item;
    const type: AgendaItemType = item?.isCourse ? 'course' : item?.isFoodBreak ? 'foodBreak' : 'agenda';
    // defaultStart should always be a real Date by the time it gets here
    // (event-agenda.component.ts coerces it before ever calling
    // openDialog()) - this fallback is just defense in depth against the
    // same "date stored as a string in Firestore" data-quality gap.
    const fallbackStart = data.defaultStart instanceof Date && !isNaN(data.defaultStart.getTime()) ? data.defaultStart : new Date();
    const start = item?.startDate ? new Date(item.startDate) : fallbackStart;
    const end = item?.endDate ? new Date(item.endDate) : new Date(start.getTime() + 60 * 60 * 1000);

    this.form = this.fb.group({
      type: [type, Validators.required],
      startDate: [this.toInputValue(start), Validators.required],
      endDate: [this.toInputValue(end), Validators.required],
      text: [item?.text ?? ''],
      description: [item?.description ?? ''],
      course: [item?.course ?? null],
      maxParticipants: [item?.maxParticipants ?? null],
      coaches: [item?.coaches ?? []],
      room: [item?.room ?? null]
    });

    this.updateConditionalValidators();
    this.form.get('type')?.valueChanges.subscribe(() => this.updateConditionalValidators());
  }

  private updateConditionalValidators(): void {
    const type: AgendaItemType = this.form.get('type')?.value;

    const toggle = (field: string, required: boolean) => {
      const control = this.form.get(field);
      control?.setValidators(required ? [Validators.required] : []);
      control?.updateValueAndValidity({ emitEvent: false });
    };

    toggle('text', type !== 'course');
    toggle('description', type !== 'course');
    toggle('course', type === 'course');
  }

  private toInputValue(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  onCancel(): void {
    this.dialogRef.close(undefined);
  }

  onDelete(): void {
    if (this.data.item) {
      this.dialogRef.close({ action: 'delete', item: this.data.item });
    }
  }

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    const type: AgendaItemType = raw.type;

    // `null`, never `undefined`, for a field that doesn't apply to this
    // type - Firestore's setDoc()/update() (a full document overwrite,
    // not a merge - see FirebaseDAO.update()) rejects the entire write if
    // any field is explicitly `undefined`, however deeply nested. This
    // item only reaches Firestore later, batched into the whole Event
    // document by events.component.ts's own onSave() - the failure mode
    // (a rejected write) doesn't surface until then, which is why this
    // went unnoticed: nothing here calls Firestore directly to catch it
    // sooner. Live-diagnosed 2026-08-14 alongside the identical bug in
    // events.component.ts's own onSave() (imageUrl) - see that file's
    // own comment.
    const item: AgendaItem = {
      ...this.data.item,
      id: this.data.item?.id ?? this.generateId(),
      startDate: new Date(raw.startDate),
      endDate: new Date(raw.endDate),
      isCourse: type === 'course',
      isFoodBreak: type === 'foodBreak',
      room: raw.room,
      // Course-type items don't carry their own text/description - the
      // calendar's own event title is derived from the linked course's
      // title instead (see event-agenda.component.ts's titleFor()),
      // matching the original's custom appointment-template behavior.
      text: type === 'course' ? null : raw.text,
      description: type === 'course' ? null : raw.description,
      course: type === 'course' ? raw.course : null,
      maxParticipants: type === 'course' ? (raw.maxParticipants ?? null) : null,
      coaches: type !== 'foodBreak' ? raw.coaches : null
    };

    this.dialogRef.close({ action: 'save', item });
  }

  private generateId(): string {
    return 'xxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
