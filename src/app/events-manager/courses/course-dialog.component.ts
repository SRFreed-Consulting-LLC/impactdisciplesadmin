import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { CourseModel } from 'src/app/common/models/domain/course.model';
import { CoachModel } from 'src/app/common/models/domain/coach.model';
import { ImpactTeamMemberModel } from 'src/app/common/models/domain/impact-team-member.model';
import { CourseService } from 'src/app/common/services/data/course.service';
import { CoachService } from 'src/app/common/services/data/coach.service';
import { ImpactTeamService } from 'src/app/common/services/data/impact-team.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { CoachDialogComponent } from '../coaches/coach-dialog.component';

export interface CourseDialogData {
  item: CourseModel | null;
}

@Component({
    selector: 'app-course-dialog',
    templateUrl: './course-dialog.component.html',
    styleUrls: ['./course-dialog.component.scss'],
    standalone: false
})
export class CourseDialogComponent implements OnInit {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;

  // One-time getAll() into a plain array, not streamAll() - matches
  // event-agenda.component.ts's own established convention for this exact
  // kind of small reference list feeding a dialog's dropdown (see that
  // file's own comment on why: avoids a burst of simultaneous streamAll()
  // listeners racing on cold load).
  coaches: CoachModel[] = [];
  // Kept as a separate array from `coaches` (not merged) - the Coaches
  // field below groups them under 2 distinct <mat-optgroup> labels so an
  // admin can see which collection an instructor comes from, even though
  // `coachIds` itself doesn't care (see impact-team.service.ts's own
  // header comment - it's just a set of ids that can point at either
  // collection now).
  impactTeamMembers: ImpactTeamMemberModel[] = [];

  private itemType = 'Course';

  constructor(
    private dialogRef: MatDialogRef<CourseDialogComponent, CourseModel>,
    @Inject(MAT_DIALOG_DATA) public data: CourseDialogData,
    private fb: FormBuilder,
    private service: CourseService,
    private coachService: CoachService,
    private impactTeamService: ImpactTeamService,
    private dialog: MatDialog,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.form = this.fb.group({
      title: [data.item?.title ?? '', Validators.required],
      length: [data.item?.length ?? ''],
      shortDescription: [data.item?.shortDescription ?? '', Validators.required],
      longDescription: [data.item?.longDescription ?? '', Validators.required],
      resources: [data.item?.resources ?? ''],
      coachIds: [data.item?.coachIds ?? []]
    });
  }

  ngOnInit(): void {
    this.coachService.getAll().then((coaches) => { this.coaches = coaches; });
    this.impactTeamService.getAll().then((members) => { this.impactTeamMembers = members; });
  }

  // "+ New Coach" next to the Coaches field - lets an admin building a
  // Summit course add a coach that doesn't exist yet without leaving this
  // dialog to go find the standalone Coaches screen. `coaches` is a
  // one-time getAll() (see ngOnInit's own comment), not a live stream, so
  // the new coach is appended here explicitly rather than relying on
  // anything to auto-refresh it - then auto-selected into coachIds so the
  // admin doesn't have to immediately re-open the dropdown to pick the
  // coach they just created.
  //
  // Deliberately Coach-only, no equivalent "+ New Team Member" button -
  // Impact Team members are meant to be administered more deliberately via
  // Web Manager > Team Page (they're public site content), not spur-of-
  // the-moment from inside a breakout/course flow. Someone who's "just for
  // Summit" belongs on the Coaches side, per the user's own framing of the
  // split.
  addCoach(): void {
    const ref = this.dialog.open<CoachDialogComponent, unknown, CoachModel>(CoachDialogComponent, { width: '900px', maxWidth: '95vw', data: { item: null } });
    ref.afterClosed().subscribe((coach) => {
      if (!coach) {
        return;
      }
      this.coaches = [...this.coaches, coach];
      const coachIds = this.form.get('coachIds');
      coachIds?.setValue([...(coachIds.value ?? []), coach.id]);
    });
  }

  onCancel(): void {
    this.dialogRef.close(undefined);
  }

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.inProgress$.next(true);
    const value: CourseModel = { ...this.data.item, ...this.form.value };

    const request = this.isEdit
      ? this.service.update(value.id!, value)
      : this.service.add(value);

    // Closes with the saved entity - see coach-dialog.component.ts's
    // identical comment on why (breakout-block-dialog.component.ts's own
    // "+ New Course" quick-create needs the created course back).
    request.then((result) => {
      if (result) {
        this.snackbar.success(this.itemType + (this.isEdit ? ' Updated' : ' Added'));
        this.dialogRef.close(result);
      } else {
        this.inProgress$.next(false);
        this.snackbar.error('Some Error Occured');
      }
    }).catch((err) => {
      // See coach-dialog.component.ts's identical .catch() comment - a
      // rejected write left inProgress$ stuck true and the dialog open
      // forever with nothing but a browser-console error, indistinguishable
      // from a hang, especially now nested 2 deep under the breakout dialog.
      console.error('Course save failed', err);
      this.inProgress$.next(false);
      this.snackbar.error('Some Error Occured');
    });
  }
}
