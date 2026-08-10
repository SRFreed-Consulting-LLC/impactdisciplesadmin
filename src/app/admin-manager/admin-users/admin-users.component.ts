import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { AdminUser } from 'src/app/common/models/admin/admin-user.model';
import { AdminUserService } from 'src/app/common/services/data/admin-user.service';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { AdminUserDialogComponent } from './admin-user-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';

@Component({
    selector: 'app-admin-users',
    templateUrl: './admin-users.component.html',
    styleUrls: ['./admin-users.component.scss'],
    standalone: false
})
export class AdminUsersComponent implements OnInit {
  users$: Observable<AdminUser[]>;

  columns: DataGridColumn<AdminUser>[] = [
    { key: 'lastName', label: 'Last Name' },
    { key: 'firstName', label: 'First Name' },
    { key: 'email', label: 'Email' },
    { key: 'role', label: 'Role' },
    { key: 'phone', label: 'Number', value: (item) => item.phone?.number ?? '' }
  ];

  itemType = 'Admin User';

  headerActions: ListHeaderAction[] = [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }];
  rowActions: DataGridRowAction<AdminUser>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item), visible: (item) => !this.isSelf(item) }];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  // Used to hide the delete action on the signed-in admin's own row - the
  // deleteAdminUser Cloud Function already blocks this server-side, but
  // catching it client-side avoids a confusing failed-request round trip
  // for an action that was never going to succeed.
  private currentUserFirebaseUID: string | undefined;

  constructor(
    private service: AdminUserService,
    private authService: AdminAuthService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.authService.dao.loggedInUser$.subscribe((user) => {
      this.currentUserFirebaseUID = user?.firebaseUID;
    });

    this.users$ = this.service.streamAll().pipe(tap(() => this.loading$.next(false)));
  }

  showAddModal(): void {
    this.dialog.open(AdminUserDialogComponent, {
      width: '800px',
      data: { item: null }
    });
  }

  showEditModal(item: AdminUser): void {
    this.dialog.open(AdminUserDialogComponent, {
      width: '800px',
      data: { item }
    });
  }

  isSelf(item: AdminUser): boolean {
    return !!item.firebaseUID && item.firebaseUID === this.currentUserFirebaseUID;
  }

  delete(item: AdminUser): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record? This also removes their login access.</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.deleteAdminUser(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        }).catch((err) => {
          this.snackbar.error('There was an error deleting the account: ' + (err?.message ?? 'Unknown error'));
        });
      }
    });
  }
}
