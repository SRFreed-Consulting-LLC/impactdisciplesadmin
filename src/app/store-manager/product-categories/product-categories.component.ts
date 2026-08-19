import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { TagModel } from 'src/app/common/models/domain/tag.model';
import { ProductCategoriesService } from 'src/app/common/services/data/product-categories.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { CategoryModalComponent } from './category-modal/category-modal.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';

// Opened via MatDialog.open(ProductCategoriesComponent, ...) from
// ProductsComponent's "Categories" menu item - there is no standalone
// route for this screen, same pattern as content-manager's
// pod-cast-categories.component (the direct precedent this was built
// from). Replaces the old NGXS ShowProductCategoriesModal/ShowCategoryModal
// action-driven, always-mounted-in-template pattern - no other migrated
// screen in this app invokes dialogs that way.
@Component({
    selector: 'app-product-categories',
    templateUrl: './product-categories.component.html',
    styleUrls: ['./product-categories.component.css'],
    standalone: false
})
export class ProductCategoriesComponent implements OnInit {
  categories$: Observable<TagModel[]>;
  columns: DataGridColumn<TagModel>[] = [
    { key: 'tag', label: 'Tag' },
    { key: 'showInStore', label: 'Show In Store', filterable: false, value: (item) => (item.showInStore ? 'Yes' : 'No') }
  ];
  rowActions: DataGridRowAction<TagModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item) }];

  itemType = 'Category';

  // House rule: loading spinner shown until first emission - see
  // contacts.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  constructor(
    private service: ProductCategoriesService,
    private dialog: MatDialog,
    private dialogRef: MatDialogRef<ProductCategoriesComponent>,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.categories$ = this.service.streamAll().pipe(tap(() => this.loading$.next(false)));
  }

  onClose(): void {
    this.dialogRef.close();
  }

  showAddModal(): void {
    this.dialog.open(CategoryModalComponent, {
      width: '400px',
      data: { item: null }
    });
  }

  showEditModal(item: TagModel): void {
    this.dialog.open(CategoryModalComponent, {
      width: '400px',
      data: { item }
    });
  }

  delete(item: TagModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
