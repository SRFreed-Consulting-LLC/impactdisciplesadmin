import { Component } from '@angular/core';
import { MatDialog, MatDialogConfig, MatDialogRef } from '@angular/material/dialog';
import { TagModel } from '@impact-common/shared/models/domain/tag.model';
import { ProductCategoriesService } from 'src/app/common/services/data/product-categories.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { BaseListComponent } from '../../shared/base-list.component';
import { CategoryModalComponent } from './category-modal/category-modal.component';
import { DataGridColumn } from '../../shared/data-grid/data-grid.model';

// Opened via MatDialog.open(ProductCategoriesComponent, ...) from
// ProductsComponent's "Categories" menu item - there is no standalone
// route for this screen - the pattern was taken from content-manager's
// former pod-cast-categories screen (removed 2026-08-21 with the rest of
// Pod Casts). Replaces the old NGXS ShowProductCategoriesModal/ShowCategoryModal
// action-driven, always-mounted-in-template pattern - no other migrated
// screen in this app invokes dialogs that way.
//
// On BaseListComponent since 2026-08-21 (bucket A item #6). screenKey is
// NULL on purpose: this dialog has no NAV_CONFIG entry of its own and has
// never been permission-gated - you already have to be on the (gated)
// Products screen to open it. Giving it a key here would ADD gating that
// does not exist today and could take New/Delete away from staff who use
// it now. The dialogRef is this screen's own, on top of the base skeleton -
// the base knows nothing about being hosted in a dialog.
@Component({
    selector: 'app-product-categories',
    templateUrl: './product-categories.component.html',
    styleUrls: ['./product-categories.component.css'],
    standalone: false
})
export class ProductCategoriesComponent extends BaseListComponent<TagModel> {
  readonly itemType = 'Category';
  protected readonly screenKey = null;
  readonly columns: DataGridColumn<TagModel>[] = [
    { key: 'tag', label: 'Tag' },
    { key: 'showInStore', label: 'Show In Store', filterable: false, value: (item) => (item.showInStore ? 'Yes' : 'No') }
  ];
  protected readonly dialogComponent = CategoryModalComponent;
  protected override readonly dialogConfig: MatDialogConfig = { width: '400px' };

  constructor(
    service: ProductCategoriesService,
    permissionService: PermissionService,
    dialog: MatDialog,
    confirmService: ConfirmService,
    snackbar: SnackbarService,
    private readonly dialogRef: MatDialogRef<ProductCategoriesComponent>
  ) {
    super(service, permissionService, dialog, confirmService, snackbar);
  }

  onClose(): void {
    this.dialogRef.close();
  }
}
