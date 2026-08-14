import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { CourseModel } from 'src/app/common/models/domain/course.model';
import { CoachModel } from 'src/app/common/models/domain/coach.model';
import { CourseService } from 'src/app/common/services/data/course.service';
import { CoachService } from 'src/app/common/services/data/coach.service';
import { SnackbarService } from '../../shared/snackbar.service';

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

  private itemType = 'Course';

  constructor(
    private dialogRef: MatDialogRef<CourseDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: CourseDialogData,
    private fb: FormBuilder,
    private service: CourseService,
    private coachService: CoachService,
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
  }

  onCancel(): void {
    this.dialogRef.close(false);
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

    request.then((result) => {
      if (result) {
        this.snackbar.success(this.itemType + (this.isEdit ? ' Updated' : ' Added'));
        this.dialogRef.close(true);
      } else {
        this.inProgress$.next(false);
        this.snackbar.error('Some Error Occured');
      }
    });
  }
}
