import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { TagModel } from '@impact-common/shared/models/domain/tag.model';
import { ProductCategoriesService } from 'src/app/common/services/data/product-categories.service';
import { SnackbarService } from '../../../shared/snackbar.service';

export interface CategoryModalData {
  item: TagModel | null;
}

@Component({
    selector: 'app-category-modal',
    templateUrl: './category-modal.component.html',
    styleUrls: ['./category-modal.component.css'],
    standalone: false
})
export class CategoryModalComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit: boolean;

  private itemType = 'Category';

  constructor(
    private dialogRef: MatDialogRef<CategoryModalComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: CategoryModalData,
    private fb: FormBuilder,
    private service: ProductCategoriesService,
    private snackbar: SnackbarService
  ) {
    this.isEdit = !!data.item?.id;
    this.form = this.fb.group({
      tag: [data.item?.tag ?? '', Validators.required],
      showInStore: [data.item?.showInStore ?? false]
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
    const value: TagModel = { ...this.data.item, ...this.form.value };

    const request = this.isEdit ? this.service.update(value.id!, value) : this.service.add(value);

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
