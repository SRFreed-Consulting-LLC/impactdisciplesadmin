import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { AgendaItem } from 'src/app/common/models/domain/utils/agenda-item.model';
import { TrainingRoomModel } from 'src/app/common/models/domain/training-room.model';
import { CoachQuickCreateDialogComponent } from './coach-quick-create-dialog.component';
import { Instructor } from './session-block.util';

export interface AgendaItemDialogData {
  item: AgendaItem | null;
  defaultStart: Date;
  // Combined Coaches + Impact Team, tagged with `source` for the grouped
  // picker - see event-agenda.component.ts's own comment.
  coaches: Instructor[];
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
//
// 2026-08 Courses retirement: a Breakout Session no longer links a Course
// record - the admin types the breakout's Title/Description directly and
// picks the coach(es) here (see agenda-item.model.ts). The legacy `course`
// id on a pre-retirement item is preserved untouched as provenance.
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
    private fb: FormBuilder,
    private dialog: MatDialog
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

    // Every type carries its own title now (a breakout's title used to
    // live on the linked course doc). Description stays required for the
    // non-course types only, matching the pre-retirement behavior.
    toggle('text', true);
    toggle('description', type === 'agenda' || type === 'foodBreak');
  }

  coachGroups(): { label: string; coaches: Instructor[] }[] {
    return [
      { label: 'Impact Team', coaches: this.data.coaches.filter((c) => c.source === 'impact_team') },
      { label: 'Coaches', coaches: this.data.coaches.filter((c) => c.source !== 'impact_team') }
    ].filter((g) => g.coaches.length > 0);
  }

  // "+ Add new coach to this event" - the slim quick-create is now the only
  // coach-creation path in the app (the Coaches screen is edit-only).
  addCoach(): void {
    const ref = this.dialog.open(CoachQuickCreateDialogComponent, { width: '480px' });
    ref.afterClosed().subscribe((coach) => {
      if (!coach) {
        return;
      }
      this.data.coaches.push({ id: coach.id, fullname: coach.fullname, source: 'coaches' });
      const coaches = this.form.get('coaches');
      coaches?.setValue([...(coaches.value ?? []), coach.id]);
    });
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
    // document by events.component.ts's own onSave().
    const item: AgendaItem = {
      ...this.data.item,
      id: this.data.item?.id ?? this.generateId(),
      startDate: new Date(raw.startDate),
      endDate: new Date(raw.endDate),
      isCourse: type === 'course',
      isFoodBreak: type === 'foodBreak',
      room: raw.room,
      text: raw.text,
      description: raw.description || null,
      // LEGACY provenance only - preserved on a still-course item, cleared
      // if the type changes away from breakout. Never set to a new value.
      course: type === 'course' ? (this.data.item?.course ?? null) : null,
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
