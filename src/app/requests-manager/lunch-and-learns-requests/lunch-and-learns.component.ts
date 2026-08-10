import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { LunchAndLearnModel } from 'src/app/common/models/domain/lunch-and-learn.model';
import { LunchAndLearnService } from 'src/app/common/services/data/lunch-and-learn.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { LunchAndLearnDialogComponent } from './lunch-and-learn-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { NewRecordTracker } from '../../shared/new-record-tracking.util';
import { timestampToTimeString } from '../../shared/time-of-day.util';

@Component({
    selector: 'app-lunch-and-learns',
    templateUrl: './lunch-and-learns.component.html',
    styleUrls: ['./lunch-and-learns.component.css'],
    standalone: false
})
export class LunchAndLearnsComponent implements OnInit {
  requests$: Observable<LunchAndLearnModel[]>;

  columns: DataGridColumn<LunchAndLearnModel>[] = [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'coordinator', label: 'Coordinator' },
    { key: 'locationName', label: 'Location Name' },
    { key: 'requestedDate', label: 'Requested Date', type: 'date' },
    { key: 'requestedStartTime', label: 'Start Time', filterable: false, value: (item) => timestampToTimeString(item.requestedStartTime) },
    { key: 'requestedEndTime', label: 'End Time', filterable: false, value: (item) => timestampToTimeString(item.requestedEndTime) },
    { key: 'email', label: 'Email' }
  ];

  itemType = 'Lunch and Learn Request';

  private readonly screenKey = 'requests-manager.lunch-and-learns';

  headerActions: ListHeaderAction[] = [];
  rowActions: DataGridRowAction<LunchAndLearnModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item), visible: () => this.permissionService.canDelete(this.screenKey) }];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  // See new-record-tracking.util.ts - marks newly-arrived requests seen the
  // moment this screen loads, and keeps them highlighted for this page view.
  tracker: NewRecordTracker<LunchAndLearnModel>;

  constructor(
    private service: LunchAndLearnService,
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

  rowClass = (row: LunchAndLearnModel): string => (this.tracker.newIds.has(row.id!) ? 'row--new' : '');

  showAddModal(): void {
    if (!this.permissionService.canAdd(this.screenKey)) {
      return;
    }
    this.dialog.open(LunchAndLearnDialogComponent, {
      width: '800px',
      maxWidth: '95vw',
      data: { item: null }
    });
  }

  showEditModal(item: LunchAndLearnModel): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.dialog.open(LunchAndLearnDialogComponent, {
      width: '800px',
      maxWidth: '95vw',
      data: { item }
    });
  }

  delete(item: LunchAndLearnModel): void {
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
