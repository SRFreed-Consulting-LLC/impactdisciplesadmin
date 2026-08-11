import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { FormSubmissionModel } from 'src/app/common/models/domain/form-submission.model';
import { FormSubmissionService } from 'src/app/common/services/data/form-submission.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { NewRecordTracker } from '../../shared/new-record-tracking.util';
import { CustomFormSubmissionDetailDialogComponent } from './custom-form-submission-detail-dialog.component';

// Submissions are viewed/reviewed, never authored by staff - a plain list
// screen (no full-page edit mode, no headerActions "New") - otherwise the
// same shape as every other Requests Manager screen (see
// seminars.component.ts), including NewRecordTracker for the "new" row
// highlight (FormSubmissionModel.newRecordStatus already matches
// NewRecordTrackable's shape, so this Just Works with zero changes there).
@Component({
    selector: 'app-custom-form-submissions',
    templateUrl: './custom-form-submissions.component.html',
    styleUrls: ['./custom-form-submissions.component.scss'],
    standalone: false
})
export class CustomFormSubmissionsComponent implements OnInit {
  submissions$: Observable<FormSubmissionModel[]>;

  columns: DataGridColumn<FormSubmissionModel>[] = [
    { key: 'submittedAt', label: 'Submitted', type: 'date', dateFormat: 'MMM d, y, h:mm a' },
    { key: 'formName', label: 'Form' }
  ];

  itemType = 'Custom Form Submission';

  private readonly screenKey = 'requests-manager.custom-form-submissions';

  // Nothing to "add" - submissions come from a filled-out form, not staff.
  headerActions: ListHeaderAction[] = [];
  rowActions: DataGridRowAction<FormSubmissionModel>[] = [
    { icon: 'visibility', tooltip: 'VIEW', onClick: (item) => this.view(item) },
    { icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item), visible: () => this.permissionService.canDelete(this.screenKey) }
  ];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  // See new-record-tracking.util.ts - marks newly-arrived submissions seen
  // the moment this screen loads, and keeps them highlighted for this page view.
  tracker: NewRecordTracker<FormSubmissionModel>;

  constructor(
    private service: FormSubmissionService,
    private permissionService: PermissionService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {
    this.tracker = new NewRecordTracker(this.service);
  }

  ngOnInit(): void {
    this.submissions$ = this.service.streamAll().pipe(
      tap((items) => this.tracker.capture(items)),
      tap(() => this.loading$.next(false))
    );
  }

  rowClass = (row: FormSubmissionModel): string => (this.tracker.newIds.has(row.id!) ? 'row--new' : '');

  view(item: FormSubmissionModel): void {
    this.dialog.open(CustomFormSubmissionDetailDialogComponent, {
      width: '600px',
      maxWidth: '95vw',
      data: { item }
    });
  }

  delete(item: FormSubmissionModel): void {
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
