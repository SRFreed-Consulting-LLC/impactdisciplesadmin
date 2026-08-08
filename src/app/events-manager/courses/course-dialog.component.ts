import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { CourseModel } from 'impactdisciplescommon/src/models/domain/course.model';
import { CourseService } from 'impactdisciplescommon/src/services/data/course.service';
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
export class CourseDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;

  private itemType = 'Course';

  constructor(
    private dialogRef: MatDialogRef<CourseDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: CourseDialogData,
    private fb: FormBuilder,
    private service: CourseService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.form = this.fb.group({
      title: [data.item?.title ?? '', Validators.required],
      length: [data.item?.length ?? ''],
      shortDescription: [data.item?.shortDescription ?? '', Validators.required],
      longDescription: [data.item?.longDescription ?? '', Validators.required],
      resources: [data.item?.resources ?? '']
    });
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
