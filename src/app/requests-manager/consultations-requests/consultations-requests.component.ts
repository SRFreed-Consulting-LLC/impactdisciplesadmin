import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { ConsultationRequestModel } from 'src/app/common/models/domain/consultation-request.model';
import { ConsultationRequestService } from 'src/app/common/services/data/consultation-request.service';
import { MatDialog } from '@angular/material/dialog';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ConsultationRequestDialogComponent } from './consultation-request-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { NewRecordTracker } from '../../shared/new-record-tracking.util';

@Component({
    selector: 'app-consultations-requests',
    templateUrl: './consultations-requests.component.html',
    styleUrls: ['./consultations-requests.component.css'],
    standalone: false
})
export class ConsultationsRequestsComponent implements OnInit {
  requests$: Observable<ConsultationRequestModel[]>;

  columns: DataGridColumn<ConsultationRequestModel>[] = [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'lastName', label: 'Last Name' },
    { key: 'firstName', label: 'First Name' },
    { key: 'email', label: 'Email' },
    { key: 'message', label: 'Message', cellClass: 'message-cell' }
  ];

  itemType = 'Consultation Request';

  private readonly screenKey = 'requests-manager.consultation-requests';

  headerActions: ListHeaderAction[] = [];
  rowActions: DataGridRowAction<ConsultationRequestModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item), visible: () => this.permissionService.canDelete(this.screenKey) }];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  // See new-record-tracking.util.ts - marks newly-arrived requests seen the
  // moment this screen loads, and keeps them highlighted for this page view.
  tracker: NewRecordTracker<ConsultationRequestModel>;

  constructor(
    private service: ConsultationRequestService,
    private permissionService: PermissionService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {
    this.tracker = new NewRecordTracker(this.service);
  }

  ngOnInit(): void {
    this.requests$ = this.service.streamAll().pipe(
      tap((items) => this.tracker.capture(items)),
      tap(() => this.loading$.next(false))
    );

    this.headerActions = this.permissionService.canAdd(this.screenKey) ? [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }] : [];
  }

  rowClass = (row: ConsultationRequestModel): string => (this.tracker.newIds.has(row.id!) ? 'row--new' : '');

  showAddModal(): void {
    if (!this.permissionService.canAdd(this.screenKey)) {
      return;
    }
    this.dialog.open(ConsultationRequestDialogComponent, {
      width: '500px',
      data: { item: null }
    });
  }

  showEditModal(item: ConsultationRequestModel): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.dialog.open(ConsultationRequestDialogComponent, {
      width: '500px',
      data: { item }
    });
  }

  delete(item: ConsultationRequestModel): void {
    if (!this.permissionService.canDelete(this.screenKey)) {
      return;
    }
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
