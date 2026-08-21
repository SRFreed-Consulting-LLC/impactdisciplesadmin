import { Component } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { SaleModel } from '@impact-common/shared/models/utils/sale.model';
import { SalesService } from 'src/app/common/services/data/sales.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { BaseListComponent } from '../../shared/base-list.component';
import { DataGridColumn } from '../../shared/data-grid/data-grid.model';
import { SaleDialogComponent } from './sale-dialog.component';
import { parseSaleDate } from './sale-date.util';

@Component({
    selector: 'app-sales',
    templateUrl: './sales.component.html',
    styleUrls: ['./sales.component.css'],
    standalone: false
})
export class SalesComponent extends BaseListComponent<SaleModel> {
  readonly itemType = 'Sale';
  protected readonly screenKey = 'store-manager.sales';
  protected readonly dialogComponent = SaleDialogComponent;

  readonly columns: DataGridColumn<SaleModel>[] = [
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

  constructor(
    service: SalesService,
    permissionService: PermissionService,
    dialog: MatDialog,
    confirmService: ConfirmService,
    snackbar: SnackbarService
  ) {
    super(service, permissionService, dialog, confirmService, snackbar);
  }
}
