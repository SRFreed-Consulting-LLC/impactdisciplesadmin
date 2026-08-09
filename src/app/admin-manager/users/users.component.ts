import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { AppUser } from 'src/app/common/models/admin/appuser.model';
import { AppUserService } from 'src/app/common/services/data/user.service';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { UserDialogComponent } from './user-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { ColumnFilterValue, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';
import { exportToExcel } from '../../shared/table-export.util';

@Component({
    selector: 'app-users',
    templateUrl: './users.component.html',
    styleUrls: ['./users.component.scss'],
    standalone: false
})
export class UsersComponent implements OnInit {
  users$: Observable<AppUser[]>;
  displayedColumns = ['lastName', 'firstName', 'email', 'role', 'phone', 'actions'];
  filterColumns = ['lastName-filter', 'firstName-filter', 'email-filter', 'role-filter', 'phone-filter', 'actions-filter'];
  textOperators = TEXT_FILTER_OPERATORS;

  itemType = 'User';

  actions: ListHeaderAction[] = [
    { label: 'New', icon: 'add', onClick: () => this.showAddModal() },
    { label: 'Export To Excel', icon: 'file_download', onClick: () => this.exportXLSGrid() }
  ];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});
  private currentRows: AppUser[] = [];

  constructor(
    private service: AppUserService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
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

  private matchesField(item: AppUser, field: string, filter: ColumnFilterValue): boolean {
    if (field === 'phone') {
      return matchesColumnFilter(item.phone?.number, filter, 'text');
    }
    return matchesColumnFilter(item[field as keyof AppUser], filter, 'text');
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
  }

  showAddModal(): void {
    this.dialog.open(UserDialogComponent, {
      width: '800px',
      data: { item: null }
    });
  }

  showEditModal(item: AppUser): void {
    this.dialog.open(UserDialogComponent, {
      width: '800px',
      data: { item }
    });
  }

  delete(item: AppUser): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }

  // Exports whatever's currently filtered/visible in currentRows, matching
  // the original's grid export (which exported the grid's current state -
  // DevExtreme's exportDataGrid also respects active filters).
  exportXLSGrid(): void {
    exportToExcel(
      this.currentRows,
      [
        { header: 'Last Name', value: (row) => row.lastName },
        { header: 'First Name', value: (row) => row.firstName },
        { header: 'Email', value: (row) => row.email },
        { header: 'UID', value: (row) => row.firebaseUID },
        { header: 'Role', value: (row) => row.role },
        { header: 'Country Code', value: (row) => row.phone?.countryCode },
        { header: 'Number', value: (row) => row.phone?.number },
        { header: 'Type', value: (row) => row.phone?.type }
      ],
      'impact_users.xlsx',
      'Users'
    );
  }
}
