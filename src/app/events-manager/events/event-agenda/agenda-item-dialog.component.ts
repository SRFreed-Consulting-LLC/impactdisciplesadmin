import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { AgendaItem } from 'src/app/common/models/domain/utils/agenda-item.model';
import { CourseModel } from 'src/app/common/models/domain/course.model';
import { CoachModel } from 'src/app/common/models/domain/coach.model';
import { TrainingRoomModel } from 'src/app/common/models/domain/training-room.model';
import { CoachService } from 'src/app/common/services/data/coach.service';
import { ImpactTeamService } from 'src/app/common/services/data/impact-team.service';
import { CourseDialogComponent } from '../../courses/course-dialog.component';
import { CoachDialogComponent } from '../../coaches/coach-dialog.component';
import { Instructor } from './session-block.util';

export interface AgendaItemDialogData {
  item: AgendaItem | null;
  defaultStart: Date;
  courses: CourseModel[];
  // Combined Coaches + Impact Team, same as BreakoutBlockDialogData - see
  // event-agenda.component.ts's own comment. Shown as one flat (ungrouped)
  // list in this dialog's own Coaches field, unlike course-dialog.component's
  // - this is the secondary/legacy per-item coach path (course assignment
  // normally happens via Course.coachIds instead, see CourseModel's own
  // comment), not worth the extra plumbing for optgroups here too.
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
    private dialog: MatDialog,
    private coachService: CoachService,
    private impactTeamService: ImpactTeamService
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

  // "+ New Course"/"+ New Coach" next to their respective fields - same
  // quick-create pattern as breakout-block-dialog.component.ts's own
  // addCourse() (see that file's identical comment on why a plain
  // this.data.coaches.push() isn't enough by itself: the nested course
  // dialog's own "+ New Coach" only updates its own local coach list, not
  // this dialog's data.coaches, so a coach created *while* creating the
  // course needs an explicit re-fetch to become pickable here too).
  addCourse(): void {
    const ref = this.dialog.open<CourseDialogComponent, unknown, CourseModel>(CourseDialogComponent, { width: '600px', data: { item: null } });
    ref.afterClosed().subscribe((course) => {
      if (!course) {
        return;
      }
      this.data.courses.push(course);
      this.form.get('course')?.setValue(course.id);

      Promise.all([this.coachService.getAll(), this.impactTeamService.getAll()]).then(([coaches, impactTeam]) => {
        this.data.coaches.length = 0;
        this.data.coaches.push(...coaches, ...impactTeam);
      });
    });
  }

  addCoach(): void {
    const ref = this.dialog.open<CoachDialogComponent, unknown, CoachModel>(CoachDialogComponent, { width: '900px', maxWidth: '95vw', data: { item: null } });
    ref.afterClosed().subscribe((coach) => {
      if (!coach) {
        return;
      }
      this.data.coaches.push(coach);
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
