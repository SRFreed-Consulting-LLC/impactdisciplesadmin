import { Component, Inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TagModel } from '@impact-common/shared/models/domain/tag.model';
import { ProductCategoriesService } from 'src/app/common/services/data/product-categories.service';
import { SnackbarService } from '../../../shared/snackbar.service';
import { BaseEntityDialogComponent } from '../../../shared/base-entity-dialog.component';

export interface CategoryModalData {
  item: TagModel | null;
}

@Component({
    selector: 'app-category-modal',
    templateUrl: './category-modal.component.html',
    styleUrls: ['./category-modal.component.css'],
    standalone: false
})
export class CategoryModalComponent extends BaseEntityDialogComponent<TagModel> {
  readonly itemType = 'Category';

  constructor(
    protected readonly dialogRef: MatDialogRef<CategoryModalComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public readonly data: CategoryModalData,
    private fb: FormBuilder,
    protected readonly service: ProductCategoriesService,
    protected readonly snackbar: SnackbarService
  ) {
    super();
    this.form = this.fb.group({
      tag: [data.item?.tag ?? '', Validators.required],
      showInStore: [data.item?.showInStore ?? false]
    });
  }

}
