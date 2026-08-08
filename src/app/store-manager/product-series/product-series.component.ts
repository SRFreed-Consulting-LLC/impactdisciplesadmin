import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { SeriesModel } from 'impactdisciplescommon/src/models/utils/series.model';
import { SeriesService } from 'impactdisciplescommon/src/services/data/series.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { SeriesModalComponent } from './series-modal/series-modal.component';
import { ColumnFilterValue, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';

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
  displayedColumns = ['imageUrl', 'order', 'name', 'showInStore', 'actions'];
  filterColumns = ['imageUrl-filter', 'order-filter', 'name-filter', 'showInStore-filter', 'actions-filter'];
  textOperators = TEXT_FILTER_OPERATORS;

  itemType = 'Series';

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});

  constructor(
    private service: SeriesService,
    private dialog: MatDialog,
    private dialogRef: MatDialogRef<ProductSeriesComponent>,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.series$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) =>
        items
          .filter((item) => Object.keys(filters).every((field) => matchesColumnFilter(item[field as keyof SeriesModel], filters[field], 'text')))
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      ),
      tap(() => this.loading$.next(false))
    );
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
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
