import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { NotificationRegistrationModel } from 'src/app/common/models/admin/notification-registration.model';
import { NotificationRegistrationService } from 'src/app/common/services/data/notification-registration.service';
import { MatDialog } from '@angular/material/dialog';
import { NotificationDialogComponent } from './notification-dialog.component';
import { ColumnFilterValue, DATE_FILTER_OPERATORS, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';

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
  displayedColumns = ['id', 'email', 'dateRegistered', 'dateRemoved', 'fcmId', 'actions'];
  filterColumns = ['id-filter', 'email-filter', 'dateRegistered-filter', 'dateRemoved-filter', 'fcmId-filter', 'actions-filter'];
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
      map(([items, filters]) =>
        items.filter((item) =>
          Object.keys(filters).every((field) => {
            const type = field === 'dateRegistered' || field === 'dateRemoved' ? 'date' : 'text';
            return matchesColumnFilter(item[field as keyof NotificationRegistrationModel], filters[field], type);
          })
        )
      ),
      tap(() => this.loading$.next(false))
    );
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
