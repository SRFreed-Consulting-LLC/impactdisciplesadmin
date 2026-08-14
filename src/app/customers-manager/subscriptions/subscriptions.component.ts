import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { SelectionModel } from '@angular/cdk/collections';
import jsPDF from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { SubscriptionModel, SubscriptionType } from 'src/app/common/models/domain/subscription.model';
import { SubscriptionService } from 'src/app/common/services/data/subscription.service';
import { EmailList } from 'src/app/common/models/utils/email-list.model';
import { EmailListService } from 'src/app/common/services/data/email-list.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { NewRecordTracker } from '../../shared/new-record-tracking.util';
import { SubscriberDialogComponent } from './subscriber-dialog.component';
import { SendSubscriptionDialogComponent } from './send-subscription-dialog.component';
import { SubscriptionListDialogComponent } from './subscription-list-dialog.component';

// Combined Newsletter + Prayer Team subscriber list - was 2 near-identical
// screens each backed by its own Firestore collection
// (newsletter_subscriptions, prayer_team_subscriptions), merged into one
// table + one collection (`subscriptions`) annotated by `type` (see
// SubscriptionModel). "Send Newsletter"/"Send Prayer Request" stay as 2
// distinct actions - each type still has genuinely different confirmation-
// email content (see SubscriptionService.sendConfirmationEmail) - just both
// now filter their audience from this one shared table instead of reading
// their own collection.
@Component({
    selector: 'app-subscriptions',
    templateUrl: './subscriptions.component.html',
    styleUrls: ['./subscriptions.component.scss'],
    standalone: false
})
export class SubscriptionsComponent implements OnInit {
  subscribers$: Observable<SubscriptionModel[]>;
  columns: DataGridColumn<SubscriptionModel>[] = [
    { key: 'lastName', label: 'Last Name' },
    { key: 'firstName', label: 'First Name' },
    { key: 'email', label: 'Email' },
    { key: 'type', label: 'Type', value: (row) => this.typeLabel(row.type) },
    { key: 'date', label: 'Date', type: 'date', filterable: false }
  ];

  itemType = 'Subscriber';

  private readonly screenKey = 'customers-manager.subscriptions';

  rowActions: DataGridRowAction<SubscriptionModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item), visible: () => this.permissionService.canDelete(this.screenKey) }];

  // See new-record-tracking.util.ts - marks newly-arrived subscribers seen
  // the moment this screen loads, and keeps them highlighted for this page
  // view. Same pattern as custom-form-submissions.component.ts/
  // purchases.component.ts.
  tracker: NewRecordTracker<SubscriptionModel>;
  rowClass = (row: SubscriptionModel): string => (this.tracker.newIds.has(row.id!) ? 'row--new' : '');

  // Kept as 2 separate arrays (rather than one combined list) purely so the
  // "Filter by List" dropdown can group them under 2 optgroups - both are
  // scoped fetches (EmailListService's `email_lists` collection also holds
  // unrelated `type: 'customers'` lists used by the Customers screen, so an
  // unfiltered getAll() here would leak those into this dropdown too).
  newsletterLists: EmailList[] = [];
  prayerLists: EmailList[] = [];
  selectedList: EmailList | undefined;
  selection = new SelectionModel<SubscriptionModel>(true, []);

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  // Stable field, not a getter - see customers.component.ts's own comment on
  // why.
  headerActions: ListHeaderAction[] = [];

  currentRows: SubscriptionModel[] = [];
  private allSubscribers: SubscriptionModel[] = [];

  constructor(
    private service: SubscriptionService,
    private emailListService: EmailListService,
    private permissionService: PermissionService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {
    this.tracker = new NewRecordTracker(this.service);
  }

  async ngOnInit(): Promise<void> {
    this.subscribers$ = this.service.streamAll().pipe(
      tap((items) => (this.allSubscribers = items)),
      tap((items) => this.tracker.capture(items)),
      tap(() => this.loading$.next(false))
    );

    await this.refreshEmailLists();
    this.refreshActions();
  }

  typeLabel(type: SubscriptionType): string {
    return type === 'prayer' ? 'Prayer Team' : 'Newsletter';
  }

  private async refreshEmailLists(): Promise<void> {
    const [newsletterLists, prayerLists] = await Promise.all([
      this.emailListService.getAllByValue('type', 'newsletter'),
      this.emailListService.getAllByValue('type', 'prayer')
    ]);
    this.newsletterLists = newsletterLists ?? [];
    this.prayerLists = prayerLists ?? [];
  }

  private refreshActions(): void {
    const canAdd = this.permissionService.canAdd(this.screenKey);
    const canEdit = this.permissionService.canEdit(this.screenKey);

    const actions: ListHeaderAction[] = [
      ...(canAdd ? [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }] : []),
      // Sending and building/saving a list both mutate existing data rather
      // than create a subscriber record, so they're gated by edit rather
      // than add. Exporting is a read-only client-side dump of what's
      // already on screen - no extra gate.
      ...(canEdit ? [{ label: 'Send Newsletter', icon: 'email', onClick: () => this.showSendModal('newsletter') }] : []),
      ...(canEdit ? [{ label: 'Send Prayer Request', icon: 'volunteer_activism', onClick: () => this.showSendModal('prayer') }] : []),
      ...(canEdit ? [{ label: 'Create List', icon: 'view_list', onClick: () => this.showListModal() }] : []),
      { label: 'Export List', icon: 'picture_as_pdf', onClick: () => this.exportPdf() }
    ];
    if (this.selectedList?.name && canEdit) {
      actions.push({ label: 'Save List', icon: 'save', onClick: () => this.onListSave() });
    }
    this.headerActions = actions;
  }

  // Backs "Export List" (selected-only PDF) - kept in sync via
  // (visibleRowsChange) since the grid now owns filtering/sorting.
  onVisibleRowsChange(rows: SubscriptionModel[]): void {
    this.currentRows = rows;
  }

  onListFilterChanged(listId: string | null): void {
    this.selection.clear();

    if (listId) {
      this.selectedList = [...this.newsletterLists, ...this.prayerLists].find((list) => list.id === listId);
      const memberIds = new Set(((this.selectedList?.list ?? []) as SubscriptionModel[]).map((s) => s.id));
      this.allSubscribers.filter((s) => memberIds.has(s.id)).forEach((s) => this.selection.select(s));
    } else {
      this.selectedList = { ...new EmailList() };
    }
    this.refreshActions();
  }

  showAddModal(): void {
    if (!this.permissionService.canAdd(this.screenKey)) {
      return;
    }
    this.dialog.open(SubscriberDialogComponent, {
      width: '500px',
      data: { item: null }
    });
  }

  showEditModal(item: SubscriptionModel): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.dialog.open(SubscriberDialogComponent, {
      width: '500px',
      data: { item }
    });
  }

  // Only offers the currently-filtered list to the send dialog if it
  // actually matches the type being sent - picking a Newsletter list in the
  // "Filter by List" dropdown and then clicking "Send Prayer Request"
  // falls back to "every Prayer Team subscriber" instead of wrongly
  // emailing the mismatched list.
  showSendModal(type: SubscriptionType): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.dialog.open(SendSubscriptionDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      data: { type, selectedList: this.selectedList?.type === type ? this.selectedList : undefined }
    });
  }

  showListModal(): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    // Always starts a brand new list from whatever rows are currently
    // checked - matches the original, which reset selectedList here
    // regardless of any list currently active in the "Filter by List" filter.
    this.selectedList = { ...new EmailList() };
    this.refreshActions();
    const dialogRef = this.dialog.open(SubscriptionListDialogComponent, {
      width: '480px',
      data: { item: null, members: this.selection.selected }
    });

    dialogRef.afterClosed().subscribe(async (saved) => {
      if (saved) {
        await this.refreshEmailLists();
      }
    });
  }

  onListSave(): void {
    if (!this.selectedList?.id || !this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.emailListService.update(this.selectedList.id, { ...this.selectedList, list: this.selection.selected }).then((item) => {
      if (item) {
        this.snackbar.success('List Updated');
      } else {
        this.snackbar.error('Some Error Occured');
      }
    });
  }

  delete(item: SubscriptionModel): void {
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

  // Exports whatever rows are currently checked - matches the original's
  // exportDataGrid({ selectedRowsOnly: true }).
  exportPdf(): void {
    const doc = new jsPDF();
    autoTable(doc, {
      startY: 12,
      head: [['Last Name', 'First Name', 'Email', 'Type', 'Date']],
      body: this.selection.selected.map((row) => [row.lastName ?? '', row.firstName ?? '', row.email ?? '', this.typeLabel(row.type), row.date instanceof Date ? row.date.toLocaleDateString() : ''])
    });
    doc.save('Subscribers.pdf');
  }
}
