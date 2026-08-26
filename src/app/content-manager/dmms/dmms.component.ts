import { Component } from '@angular/core';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { DMMModel } from '@impact-common/shared/models/domain/dmm.model';
import { DMMService } from 'src/app/common/services/data/dmm.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { BaseListComponent } from '../../shared/base-list.component';
import { DataGridColumn } from '../../shared/data-grid/data-grid.model';
import { DMMDialogComponent } from './dmm-dialog.component';

@Component({
    selector: 'app-dmms',
    templateUrl: './dmms.component.html',
    styleUrls: ['./dmms.component.css'],
    standalone: false
})
export class DMMServiceComponent extends BaseListComponent<DMMModel> {
  readonly itemType = 'Disciple Making Minute';
  protected readonly screenKey = 'content-manager.disciple-making-minute';
  protected readonly dialogComponent = DMMDialogComponent;
  protected override readonly dialogConfig: MatDialogConfig = { width: '1200px', maxWidth: '95vw' };

  readonly columns: DataGridColumn<DMMModel>[] = [
    // No filter for isActive (matches the original - filtering a computed
    // LIVE/INACTIVE label by text doesn't map cleanly to the operator set),
    // but it IS sortable - by the underlying boolean, not the label text.
    { key: 'isActive', label: 'Live', filterable: false, sortFn: (a, b) => Number(a.isActive) - Number(b.isActive) },
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'title', label: 'Title' }
  ];

  constructor(
    service: DMMService,
    permissionService: PermissionService,
    dialog: MatDialog,
    confirmService: ConfirmService,
    snackbar: SnackbarService
  ) {
    super(service, permissionService, dialog, confirmService, snackbar);
  }
}
