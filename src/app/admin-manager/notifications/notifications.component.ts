import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { NotificationRegistrationModel } from 'src/app/common/models/admin/notification-registration.model';
import { NotificationRegistrationService } from 'src/app/common/services/data/notification-registration.service';
import { MatDialog } from '@angular/material/dialog';
import { PermissionService } from 'src/app/common/services/permission.service';
import { NotificationDialogComponent } from './notification-dialog.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';

// Only the grid's "Send Notification" row action opens the dialog here,
// matching the original - there's no page-level "New" action and no delete
// button in this grid. Both showAddModal and delete() existed in the
// original component but were never wired to anything in its template, so
// omitting them here changes nothing observable.
@Component({
    selector: 'app-notifications',
    templateUrl: './notifications.component.html',
    styleUrls: ['./notifications.component.css'],
    standalone: false
})
export class NotificationsComponent implements OnInit {
  notifications$: Observable<NotificationRegistrationModel[]>;

  columns: DataGridColumn<NotificationRegistrationModel>[] = [
    { key: 'id', label: 'Id' },
    { key: 'email', label: 'Email' },
    { key: 'dateRegistered', label: 'Date Registered', type: 'date', dateFormat: 'MM/dd/yyyy' },
    { key: 'dateRemoved', label: 'Date Removed', type: 'date', dateFormat: 'MM/dd/yyyy' },
    { key: 'fcmId', label: 'Fcm Id' }
  ];

  itemType = 'Notifications';

  private readonly screenKey = 'admin-manager.notifications';

  rowActions: DataGridRowAction<NotificationRegistrationModel>[] = [{ icon: 'comment', tooltip: 'Send Notification', onClick: (item) => this.showEditModal(item), visible: () => this.permissionService.canEdit(this.screenKey) }];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  constructor(
    private service: NotificationRegistrationService,
    private permissionService: PermissionService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.notifications$ = this.service.streamAll().pipe(tap(() => this.loading$.next(false)));
  }

  showEditModal(item: NotificationRegistrationModel): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.dialog.open(NotificationDialogComponent, {
      width: '600px',
      data: { item }
    });
  }
}
