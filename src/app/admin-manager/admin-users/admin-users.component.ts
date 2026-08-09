import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { AdminUser } from 'src/app/common/models/admin/admin-user.model';
import { AdminUserService } from 'src/app/common/services/data/admin-user.service';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { AdminUserDialogComponent } from './admin-user-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { ColumnFilterValue, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';
import { ExcelColumn, exportToExcel } from '../../shared/table-export.util';

interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
}

@Component({
    selector: 'app-admin-users',
    templateUrl: './admin-users.component.html',
    styleUrls: ['./admin-users.component.scss'],
    standalone: false
})
export class AdminUsersComponent implements OnInit {
  users$: Observable<AdminUser[]>;
  currentRows: AdminUser[] = [];
  columns: ColumnDef[] = [
    { key: 'lastName', label: 'Last Name', visible: true },
    { key: 'firstName', label: 'First Name', visible: true },
    { key: 'email', label: 'Email', visible: true },
    { key: 'role', label: 'Role', visible: true },
    { key: 'phone', label: 'Number', visible: true }
  ];
  textOperators = TEXT_FILTER_OPERATORS;

  itemType = 'Admin User';

  actions: ListHeaderAction[] = [
    { label: 'New', icon: 'add', onClick: () => this.showAddModal() }
  ];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  // Used to hide the delete action on the signed-in admin's own row - the
  // deleteAdminUser Cloud Function already blocks this server-side, but
  // catching it client-side avoids a confusing failed-request round trip
  // for an action that was never going to succeed.
  private currentUserFirebaseUID: string | undefined;

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});

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

    this.users$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) =>
        items
          .filter((item) => Object.keys(filters).every((field) => this.matchesField(item, field, filters[field])))
          .sort((a, b) => (a.lastName ?? '').localeCompare(b.lastName ?? ''))
      ),
      map((rows) => {
        this.currentRows = rows;
        return rows;
      }),
      tap(() => this.loading$.next(false))
    );
  }

  get displayedColumns(): string[] {
    return [...this.columns.filter((c) => c.visible).map((c) => c.key), 'actions'];
  }

  get filterColumns(): string[] {
    return [...this.columns.filter((c) => c.visible).map((c) => `${c.key}-filter`), 'actions-filter'];
  }

  toggleColumn(column: ColumnDef): void {
    column.visible = !column.visible;
  }

  private matchesField(item: AdminUser, field: string, filter: ColumnFilterValue): boolean {
    if (field === 'phone') {
      return matchesColumnFilter(item.phone?.number, filter, 'text');
    }
    return matchesColumnFilter(item[field as keyof AdminUser], filter, 'text');
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
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

  // Exports whatever's currently filtered/visible in currentRows, matching
  // the original's grid export (which exported the grid's current state -
  // DevExtreme's exportDataGrid also respects active filters).
  exportExcel(): void {
    const visible = this.columns.filter((c) => c.visible);
    const excelColumns: ExcelColumn<AdminUser>[] = visible.map((c) => ({
      header: c.label,
      value: (row) => (c.key === 'phone' ? row.phone?.number : (row as any)[c.key]) ?? ''
    }));
    exportToExcel(this.currentRows, excelColumns, 'admin_users.xlsx', 'Admin Users');
  }
}
