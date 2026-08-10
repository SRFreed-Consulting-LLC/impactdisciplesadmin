import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { SaleModel } from 'src/app/common/models/utils/sale.model';
import { SalesService } from 'src/app/common/services/data/sales.service';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { SaleDialogComponent } from './sale-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { parseSaleDate } from './sale-date.util';

@Component({
    selector: 'app-sales',
    templateUrl: './sales.component.html',
    styleUrls: ['./sales.component.css'],
    standalone: false
})
export class SalesComponent implements OnInit {
  sales$: Observable<SaleModel[]>;

  columns: DataGridColumn<SaleModel>[] = [
    { key: 'isActive', label: 'Live', filterable: false, sortFn: (a, b) => Number(a.isActive) - Number(b.isActive) },
    { key: 'name', label: 'Name' },
    { key: 'startDate', label: 'From', type: 'date', value: (item) => parseSaleDate(item.startDate) },
    { key: 'endDate', label: 'To', type: 'date', value: (item) => parseSaleDate(item.endDate) },
    { key: 'percentOff', label: 'Percent Off', type: 'number' },
    { key: 'amountOff', label: 'Amount Off', type: 'number' },
    { key: 'isProducts', label: 'Products', filterable: false, value: (item) => (item.isProducts ? 'Yes' : 'No') },
    { key: 'isEvents', label: 'Events', filterable: false, value: (item) => (item.isEvents ? 'Yes' : 'No') },
    { key: 'isShipping', label: 'Shipping', filterable: false, value: (item) => (item.isShipping ? 'Yes' : 'No') }
  ];

  itemType = 'Sale';

  headerActions: ListHeaderAction[] = [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }];
  rowActions: DataGridRowAction<SaleModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item) }];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  constructor(
    private service: SalesService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.sales$ = this.service.streamAll().pipe(tap(() => this.loading$.next(false)));
  }

  showAddModal(): void {
    this.dialog.open(SaleDialogComponent, {
      width: '600px',
      data: { item: null }
    });
  }

  showEditModal(item: SaleModel): void {
    this.dialog.open(SaleDialogComponent, {
      width: '600px',
      data: { item }
    });
  }

  delete(item: SaleModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
