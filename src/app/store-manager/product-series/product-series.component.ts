import { Component } from '@angular/core';
import { MatDialog, MatDialogConfig, MatDialogRef } from '@angular/material/dialog';
import { SeriesModel } from '@impact-common/shared/models/utils/series.model';
import { SeriesService } from 'src/app/common/services/data/series.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { BaseListComponent } from '../../shared/base-list.component';
import { SeriesModalComponent } from './series-modal/series-modal.component';
import { DataGridColumn } from '../../shared/data-grid/data-grid.model';

// Opened via MatDialog.open(ProductSeriesComponent, ...) from
// ProductsComponent's "Series" menu item - same pattern as
// ProductCategoriesComponent. Replaces the old NGXS
// ShowProductSeriesModal/ShowSeriesModal action-driven, always-mounted
// pattern.
//
// On BaseListComponent since 2026-08-21 (bucket A item #6), with screenKey
// NULL - see ProductCategoriesComponent's comment for why that is
// deliberate rather than an oversight.
@Component({
    selector: 'app-product-series',
    templateUrl: './product-series.component.html',
    styleUrls: ['./product-series.component.css'],
    standalone: false
})
export class ProductSeriesComponent extends BaseListComponent<SeriesModel> {
  readonly itemType = 'Series';
  protected readonly screenKey = null;
  readonly columns: DataGridColumn<SeriesModel>[] = [
    { key: 'imageUrl', label: 'Image', filterable: false, sortable: false, value: (item) => item.imageUrl?.name ?? '' },
    { key: 'order', label: 'Order', type: 'number', filterable: false },
    { key: 'name', label: 'Name' },
    { key: 'showInStore', label: 'Show In Store', filterable: false, value: (item) => (item.showInStore ? 'Yes' : 'No') }
  ];
  protected readonly dialogComponent = SeriesModalComponent;
  protected override readonly dialogConfig: MatDialogConfig = { width: '500px' };

  constructor(
    service: SeriesService,
    permissionService: PermissionService,
    dialog: MatDialog,
    confirmService: ConfirmService,
    snackbar: SnackbarService,
    private readonly dialogRef: MatDialogRef<ProductSeriesComponent>
  ) {
    super(service, permissionService, dialog, confirmService, snackbar);
  }

  onClose(): void {
    this.dialogRef.close();
  }
}
