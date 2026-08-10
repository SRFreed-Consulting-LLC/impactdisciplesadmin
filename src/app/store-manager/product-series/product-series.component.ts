import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { SeriesModel } from 'src/app/common/models/utils/series.model';
import { SeriesService } from 'src/app/common/services/data/series.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { SeriesModalComponent } from './series-modal/series-modal.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';

// Opened via MatDialog.open(ProductSeriesComponent, ...) from
// ProductsComponent's "Series" menu item - same pattern as
// ProductCategoriesComponent (itself modeled on web-manager's
// pod-cast-categories.component). Replaces the old NGXS
// ShowProductSeriesModal/ShowSeriesModal action-driven, always-mounted
// pattern.
@Component({
    selector: 'app-product-series',
    templateUrl: './product-series.component.html',
    styleUrls: ['./product-series.component.css'],
    standalone: false
})
export class ProductSeriesComponent implements OnInit {
  series$: Observable<SeriesModel[]>;

  columns: DataGridColumn<SeriesModel>[] = [
    { key: 'imageUrl', label: 'Image', filterable: false, sortable: false, value: (item) => item.imageUrl?.name ?? '' },
    { key: 'order', label: 'Order', type: 'number', filterable: false },
    { key: 'name', label: 'Name' },
    { key: 'showInStore', label: 'Show In Store', filterable: false, value: (item) => (item.showInStore ? 'Yes' : 'No') }
  ];
  rowActions: DataGridRowAction<SeriesModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item) }];

  itemType = 'Series';

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  constructor(
    private service: SeriesService,
    private dialog: MatDialog,
    private dialogRef: MatDialogRef<ProductSeriesComponent>,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.series$ = this.service.streamAll().pipe(tap(() => this.loading$.next(false)));
  }

  onClose(): void {
    this.dialogRef.close();
  }

  showAddModal(): void {
    this.dialog.open(SeriesModalComponent, {
      width: '500px',
      data: { item: null }
    });
  }

  showEditModal(item: SeriesModel): void {
    this.dialog.open(SeriesModalComponent, {
      width: '500px',
      data: { item }
    });
  }

  delete(item: SeriesModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
