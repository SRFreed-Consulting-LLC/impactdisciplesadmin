import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { Timestamp } from 'firebase/firestore';
import { TestimonialModel } from 'src/app/common/models/domain/testimonial.model';
import { TestimonialService } from 'src/app/common/services/data/testimonial.service';
import { TESTIMONIAL_TYPES } from 'src/app/common/lists/testimonial_types.enum';
import { EnumHelper } from 'src/app/common/utils/enum_helper';
import { SnackbarService } from '../../shared/snackbar.service';

export interface TestimonialDialogData {
  item: TestimonialModel | null;
}

@Component({
    selector: 'app-testimonial-dialog',
    templateUrl: './testimonial-dialog.component.html',
    styleUrls: ['./testimonial-dialog.component.scss'],
    standalone: false
})
export class TestimonialDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;
  testimonialTypes: TESTIMONIAL_TYPES[] = EnumHelper.getTestimonialTypesAsArray();

  private itemType = 'Testimonial';

  constructor(
    private dialogRef: MatDialogRef<TestimonialDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: TestimonialDialogData,
    private fb: FormBuilder,
    private service: TestimonialService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.form = this.fb.group({
      isActive: [data.item?.isActive ?? false],
      author: [data.item?.author ?? '', Validators.required],
      title: [data.item?.title ?? ''],
      text: [data.item?.text ?? '', Validators.required],
      type: [data.item?.type ?? null, Validators.required]
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
    // Matches the original behavior: date is always re-stamped to "now" on
    // save, on both add and edit - not just set once when first created.
    const value: TestimonialModel = {
      ...this.data.item,
      ...this.form.value,
      date: Timestamp.now()
    };

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
