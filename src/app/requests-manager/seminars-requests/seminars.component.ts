import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { SeminarModel } from 'src/app/common/models/domain/seminar.model';
import { SeminarService } from 'src/app/common/services/data/seminar.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { SeminarDialogComponent } from './seminar-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { NewRecordTracker } from '../../shared/new-record-tracking.util';
import { timestampToTimeString } from '../../shared/time-of-day.util';

@Component({
    selector: 'app-seminars',
    templateUrl: './seminars.component.html',
    styleUrls: ['./seminars.component.css'],
    standalone: false
})
export class SeminarsComponent implements OnInit {
  seminars$: Observable<SeminarModel[]>;

  columns: DataGridColumn<SeminarModel>[] = [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'eventCoordinator', label: 'Coordinator' },
    { key: 'preferredLocationName', label: 'Location Name' },
    { key: 'requestedDate', label: 'Requested Date', type: 'date' },
    { key: 'requestedStartTime', label: 'Start Time', filterable: false, value: (item) => timestampToTimeString(item.requestedStartTime) },
    { key: 'requestedEndTime', label: 'End Time', filterable: false, value: (item) => timestampToTimeString(item.requestedEndTime) },
    { key: 'email', label: 'Email' }
  ];

  itemType = 'Seminar Request';

  headerActions: ListHeaderAction[] = [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }];
  rowActions: DataGridRowAction<SeminarModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item) }];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  // See new-record-tracking.util.ts - marks newly-arrived requests seen the
  // moment this screen loads, and keeps them highlighted for this page view.
  tracker: NewRecordTracker<SeminarModel>;

  constructor(
    private service: SeminarService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {
    this.tracker = new NewRecordTracker(this.service);
  }

  ngOnInit(): void {
    this.seminars$ = this.service.streamAll().pipe(
      tap((items) => this.tracker.capture(items)),
      tap(() => this.loading$.next(false))
    );
  }

  rowClass = (row: SeminarModel): string => (this.tracker.newIds.has(row.id!) ? 'row--new' : '');

  showAddModal(): void {
    this.dialog.open(SeminarDialogComponent, {
      width: '800px',
      maxWidth: '95vw',
      data: { item: null }
    });
  }

  showEditModal(item: SeminarModel): void {
    this.dialog.open(SeminarDialogComponent, {
      width: '800px',
      maxWidth: '95vw',
      data: { item }
    });
  }

  delete(item: SeminarModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
