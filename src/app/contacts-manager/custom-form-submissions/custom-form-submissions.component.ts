import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { FormSubmissionModel } from '@impact-common/shared/models/domain/form-submission.model';
import { FormSubmissionService } from 'src/app/common/services/data/form-submission.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { NewRecordTracker } from '../../shared/new-record-tracking.util';
import { PagedCollectionSource } from '../../shared/paged-collection-source';
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
  // One-time paged fetches (newest first) instead of the whole-collection
  // streamAll() this screen started with - see purchases.component.ts/
  // log-messages.component.ts for the established pattern this mirrors.
  // Trade-off (same as those screens): rows don't update live from other
  // sessions, and the filter row only searches rows loaded so far. This
  // screen's own mutations (forward/reopen/delete) reload page 1 explicitly
  // so their status/row changes still show up immediately.
  paged: PagedCollectionSource<FormSubmissionModel>;

  columns: DataGridColumn<FormSubmissionModel>[] = [
    { key: 'submittedAt', label: 'Submitted', type: 'date', dateFormat: 'MMM d, y, h:mm a' },
    { key: 'formName', label: 'Form' },
    { key: 'status', label: 'Status', filterable: false, sortable: false, value: (row) => this.statusLabel(row) }
  ];

  itemType = 'Form Submission';

  private readonly screenKey = 'contacts-manager.custom-form-submissions';

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
    this.paged = new PagedCollectionSource<FormSubmissionModel>(
      (pageSize, cursor) => this.service.getPage(pageSize, cursor, 'submittedAt', 'desc'),
      50
    );
  }

  ngOnInit(): void {
    // Each page already comes back ordered by submittedAt desc from
    // Firestore, and pages are appended in fetch order - no client-side
    // re-sort needed, so the template no longer sets [initialSortKey].
    this.paged.loadFirstPage();

    // NewRecordTracker.capture() only ever needs whatever's currently
    // loaded (it marks-seen once, on first call, and no-ops after) - with
    // streamAll() that first emission used to be the whole collection, now
    // it's just page 1. A "new" submission is inherently recent, so page 1
    // in submittedAt-desc order should always include it in practice - see
    // purchases.component.ts for the same note on this behavior change.
    this.paged.rows$.subscribe((items) => this.tracker.capture(items));
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
          // Paged rows don't update live - reload so the row disappears.
          this.paged.loadFirstPage();
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
    // The dialog closes with `true` only after a successful send+update -
    // paged rows don't update live, so reload to pick up the new status.
    this.dialog.open(RouteRequestDialogComponent, {
      width: '860px',
      maxWidth: '95vw',
      maxHeight: '85vh',
      data: { item }
    }).afterClosed().subscribe((routed) => {
      if (routed) {
        this.paged.loadFirstPage();
      }
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
      // Paged rows don't update live - reload so the status flip shows.
      this.paged.loadFirstPage();
    });
  }
}
