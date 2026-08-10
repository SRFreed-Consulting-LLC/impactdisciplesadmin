import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { NotificationRegistrationModel } from 'src/app/common/models/admin/notification-registration.model';
import { NotificationRegistrationService } from 'src/app/common/services/data/notification-registration.service';
import { MatDialog } from '@angular/material/dialog';
import { NotificationDialogComponent } from './notification-dialog.component';
import { ColumnFilterValue, DATE_FILTER_OPERATORS, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';
import { ExcelColumn, exportToExcel } from '../../shared/table-export.util';

interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
}

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
  currentRows: NotificationRegistrationModel[] = [];
  columns: ColumnDef[] = [
    { key: 'id', label: 'Id', visible: true },
    { key: 'email', label: 'Email', visible: true },
    { key: 'dateRegistered', label: 'Date Registered', visible: true },
    { key: 'dateRemoved', label: 'Date Removed', visible: true },
    { key: 'fcmId', label: 'FCM Id', visible: true }
  ];
  textOperators = TEXT_FILTER_OPERATORS;
  dateOperators = DATE_FILTER_OPERATORS;

  itemType = 'Notifications';

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});

  constructor(
    private service: NotificationRegistrationService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.notifications$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) => {
        const filtered = items.filter((item) =>
          Object.keys(filters).every((field) => {
            const type = field === 'dateRegistered' || field === 'dateRemoved' ? 'date' : 'text';
            return matchesColumnFilter(item[field as keyof NotificationRegistrationModel], filters[field], type);
          })
        );
        this.currentRows = filtered;
        return filtered;
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

  exportExcel(): void {
    const visible = this.columns.filter((c) => c.visible);
    const excelColumns: ExcelColumn<NotificationRegistrationModel>[] = visible.map((c) => ({
      header: c.label,
      value: (item) => ((item as unknown as Record<string, unknown>)[c.key] as string | number | Date | null | undefined) ?? ''
    }));
    exportToExcel(this.currentRows, excelColumns, 'notifications.xlsx');
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
  }

  showEditModal(item: NotificationRegistrationModel): void {
    this.dialog.open(NotificationDialogComponent, {
      width: '600px',
      data: { item }
    });
  }
}
