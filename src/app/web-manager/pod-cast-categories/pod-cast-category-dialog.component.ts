import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { TagModel } from 'src/app/common/models/domain/tag.model';
import { PodCastCategoriesService } from 'src/app/common/services/data/pod-cast-categories.service';
import { SnackbarService } from '../../shared/snackbar.service';

export interface PodCastCategoryDialogData {
  item: TagModel | null;
}

@Component({
    selector: 'app-pod-cast-category-dialog',
    templateUrl: './pod-cast-category-dialog.component.html',
    styleUrls: ['./pod-cast-category-dialog.component.scss'],
    standalone: false
})
export class PodCastCategoryDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;

  private itemType = 'Categories';

  constructor(
    private dialogRef: MatDialogRef<PodCastCategoryDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: PodCastCategoryDialogData,
    private fb: FormBuilder,
    private service: PodCastCategoriesService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.form = this.fb.group({
      tag: [data.item?.tag ?? '', Validators.required]
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
    const value: TagModel = { ...this.data.item, tag: this.form.value.tag };

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
