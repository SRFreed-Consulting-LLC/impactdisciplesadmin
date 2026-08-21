import { Component } from '@angular/core';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { CouponModel } from '@impact-common/shared/models/utils/coupon.model';
import { CouponService } from 'src/app/common/services/data/coupon.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { BaseListComponent } from '../../shared/base-list.component';
import { DataGridColumn } from '../../shared/data-grid/data-grid.model';
import { CouponDialogComponent } from './coupon-dialog.component';

@Component({
    selector: 'app-coupons',
    templateUrl: './coupons.component.html',
    styleUrls: ['./coupons.component.scss'],
    standalone: false
})
export class CouponsComponent extends BaseListComponent<CouponModel> {
  readonly itemType = 'Coupon';
  protected readonly screenKey = 'store-manager.coupons';
  protected readonly dialogComponent = CouponDialogComponent;
  protected override readonly dialogConfig: MatDialogConfig = { width: '900px', maxWidth: '95vw' };

  readonly columns: DataGridColumn<CouponModel>[] = [
    { key: 'isActive', label: 'Live', filterable: false, sortFn: (a, b) => Number(a.isActive) - Number(b.isActive) },
    { key: 'code', label: 'Code' },
    { key: 'percentOff', label: 'Percent Off', type: 'number' },
    { key: 'affilliateName', label: 'Affiliate Name' }
  ];

  constructor(
    service: CouponService,
    permissionService: PermissionService,
    dialog: MatDialog,
    confirmService: ConfirmService,
    snackbar: SnackbarService
  ) {
    super(service, permissionService, dialog, confirmService, snackbar);
  }
}
