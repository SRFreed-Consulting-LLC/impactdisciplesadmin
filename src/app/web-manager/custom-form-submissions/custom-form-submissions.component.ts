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
import { RouteRequestDialogComponent } from '../../shared/route-request-dialog/route-request-dialog.component';

// Submissions are viewed/reviewed, never authored by staff - a plain list
// screen (no full-page edit mode, no headerActions "New") - includes
// NewRecordTracker for the "new" row highlight (FormSubmissionModel.
// newRecordStatus already matches NewRecordTrackable's shape, so this Just
// Works with zero changes there). Moved here from the old Requests Manager
// module (which it now fully replaces, see the other 4 request-type
// screens' removal) - see form-builder.component.ts for the form-authoring
// side of this same feature.
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
    { key: 'formName', label: 'Form' },
    { key: 'status', label: 'Status', filterable: false, sortable: false, value: (row) => this.statusLabel(row) }
  ];

  itemType = 'Custom Form Submission';

  private readonly screenKey = 'web-manager.custom-form-submissions';

  // Nothing to "add" - submissions come from a filled-out form, not staff.
  headerActions: ListHeaderAction[] = [];
  rowActions: DataGridRowAction<FormSubmissionModel>[] = [
    { icon: 'visibility', tooltip: 'VIEW', onClick: (item) => this.view(item) },
    // Forward/Reopen - see RouteRequestDialogComponent and
    // dashboard.component.ts's own New Requests section, which this
    // mirrors. Forward is hidden once already routed (use Reopen instead of
    // re-forwarding over an existing routing) and vice versa.
    { icon: 'forward_to_inbox', tooltip: 'FORWARD', onClick: (item) => this.forward(item), visible: (item) => item.status !== 'routed' },
    { icon: 'undo', tooltip: 'REOPEN', onClick: (item) => this.reopen(item), visible: (item) => item.status === 'routed' },
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

  statusLabel(item: FormSubmissionModel): string {
    if (item.status !== 'routed') {
      return 'Open';
    }
    return `Routed to ${item.routedTo?.name ?? 'Unknown'}`;
  }

  forward(item: FormSubmissionModel): void {
    this.dialog.open(RouteRequestDialogComponent, {
      width: '560px',
      maxWidth: '95vw',
      data: { item }
    });
  }

  // Brings a misrouted request back to 'open' (and back onto the
  // dashboard's New Requests section) without re-sending anything - the
  // last routing's routedTo/routedNote/routedAt/routedBy are left in place
  // as history (see FormSubmissionModel's own comment), just no longer
  // authoritative once forwarded again.
  reopen(item: FormSubmissionModel): void {
    this.service.update(item.id!, { ...item, status: 'open' }).then(() => {
      this.snackbar.success('Request reopened');
    });
  }
}
