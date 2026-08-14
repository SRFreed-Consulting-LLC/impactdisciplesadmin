import { Component, OnInit } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { SelectionModel } from '@angular/cdk/collections';
import jsPDF from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { CustomerModel, SubscriptionType, subscriptionFieldsForType } from 'src/app/common/models/domain/utils/customer.model';
import { CustomerService } from 'src/app/common/services/data/customer.service';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { EmailList } from 'src/app/common/models/utils/email-list.model';
import { EmailListService } from 'src/app/common/services/data/email-list.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { SubscriberDialogComponent } from './subscriber-dialog.component';
import { SendSubscriptionDialogComponent } from './send-subscription-dialog.component';
import { SubscriptionListDialogComponent } from './subscription-list-dialog.component';
import { SubscriberRow } from './subscriber-row.model';

// Combined Newsletter + Prayer Team subscriber list - used to be its own
// `subscriptions` collection (merged from 2 even older ones); now it's just
// 2 booleans + dates on the `customers` collection (see customer.model.ts's
// own comment, and functions/src/subscriptions.functions.ts for the public
// site's 2 write endpoints). This screen queries `customers` by each flag
// (one-time getAllByValue, not streamAll() - `customers` is the large/
// paginated collection now, see CLAUDE.md's Pagination section, not a small
// reference table worth an always-on listener) and flattens the 2 result
// sets into one row-per-subscription-type list, the same shape the old
// collection had.
@Component({
    selector: 'app-subscriptions',
    templateUrl: './subscriptions.component.html',
    styleUrls: ['./subscriptions.component.scss'],
    standalone: false
})
export class SubscriptionsComponent implements OnInit {
  subscribers: SubscriberRow[] = [];
  columns: DataGridColumn<SubscriberRow>[] = [
    { key: 'lastName', label: 'Last Name' },
    { key: 'firstName', label: 'First Name' },
    { key: 'email', label: 'Email' },
    { key: 'type', label: 'Type', value: (row) => this.typeLabel(row.type) },
    { key: 'date', label: 'Date', type: 'date', filterable: false }
  ];

  itemType = 'Subscriber';

  private readonly screenKey = 'customers-manager.subscriptions';

  rowActions: DataGridRowAction<SubscriberRow>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item), visible: () => this.permissionService.canDelete(this.screenKey) }];

  // No more row--new highlighting here: that came from a 4th onCreate/
  // onUpdate trigger pair on the old standalone `subscriptions` collection,
  // deliberately removed alongside it (see new-record-alerts.functions.ts's
  // own comment) - a `customers` doc being created/updated is no longer a
  // reliable "just subscribed" signal, most Customer docs are created by a
  // purchase or event registration instead (see customer.model.ts).

  // Kept as 2 separate arrays (rather than one combined list) purely so the
  // "Filter by List" dropdown can group them under 2 optgroups - both are
  // scoped fetches (EmailListService's `email_lists` collection also holds
  // unrelated `type: 'customers'` lists used by the Customers screen, so an
  // unfiltered getAll() here would leak those into this dropdown too).
  newsletterLists: EmailList[] = [];
  prayerLists: EmailList[] = [];
  selectedList: EmailList | undefined;
  selection = new SelectionModel<SubscriberRow>(true, []);

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  // Stable field, not a getter - see customers.component.ts's own comment on
  // why.
  headerActions: ListHeaderAction[] = [];

  currentRows: SubscriberRow[] = [];

  constructor(
    private service: CustomerService,
    private emailListService: EmailListService,
    private permissionService: PermissionService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  async ngOnInit(): Promise<void> {
    await this.refresh();
    await this.refreshEmailLists();
    this.refreshActions();
  }

  // One-time fetch, not a live stream (see this component's own file
  // comment) - re-run after anything that changes a flag (add/edit/delete)
  // instead of relying on a standing listener.
  private async refresh(): Promise<void> {
    this.loading$.next(true);
    const [newsletterCustomers, prayerCustomers] = await Promise.all([
      this.service.getAllByValue('subscribedToNewsletter', true),
      this.service.getAllByValue('subscribedToPrayerTeam', true)
    ]);
    this.subscribers = [
      ...newsletterCustomers.map((c) => this.toRow(c, 'newsletter')),
      ...prayerCustomers.map((c) => this.toRow(c, 'prayer'))
    ];
    this.loading$.next(false);
  }

  private toRow(customer: CustomerModel, type: SubscriptionType): SubscriberRow {
    const { dateField } = subscriptionFieldsForType(type);
    return {
      id: `${customer.id}:${type}`,
      type,
      firstName: customer.firstName ?? '',
      lastName: customer.lastName ?? '',
      email: customer.email ?? '',
      date: dateFromTimestamp(customer[dateField]),
      customer
    };
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
  onVisibleRowsChange(rows: SubscriberRow[]): void {
    this.currentRows = rows;
  }

  onListFilterChanged(listId: string | null): void {
    this.selection.clear();

    if (listId) {
      this.selectedList = [...this.newsletterLists, ...this.prayerLists].find((list) => list.id === listId);
      const memberIds = new Set(((this.selectedList?.list ?? []) as SubscriberRow[]).map((s) => s.id));
      this.subscribers.filter((s) => memberIds.has(s.id)).forEach((s) => this.selection.select(s));
    } else {
      this.selectedList = { ...new EmailList() };
    }
    this.refreshActions();
  }

  showAddModal(): void {
    if (!this.permissionService.canAdd(this.screenKey)) {
      return;
    }
    const dialogRef = this.dialog.open(SubscriberDialogComponent, {
      width: '500px',
      data: { item: null }
    });
    dialogRef.afterClosed().subscribe(async (saved) => {
      if (saved) {
        await this.refresh();
      }
    });
  }

  showEditModal(item: SubscriberRow): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    const dialogRef = this.dialog.open(SubscriberDialogComponent, {
      width: '500px',
      data: { item }
    });
    dialogRef.afterClosed().subscribe(async (saved) => {
      if (saved) {
        await this.refresh();
      }
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

  // Clears just this row's flag on the underlying customer (leaving the
  // *SubscribedDate field alone - "last subscribed", not "currently
  // subscribed since", see customer.model.ts) rather than deleting the
  // customer record itself, which may carry real purchase/order history
  // completely unrelated to this subscription. Same behavior as the public
  // unsubscribe link (functions/src/subscriptions.functions.ts's
  // unsubscribe_from_email_list), just triggered from the admin side.
  delete(item: SubscriberRow): void {
    if (!this.permissionService.canDelete(this.screenKey)) {
      return;
    }
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (!confirmed) {
        return;
      }
      const { flagField } = subscriptionFieldsForType(item.type);
      this.service.update(item.customer.id!, { ...item.customer, [flagField]: false }).then(async () => {
        this.snackbar.success(this.itemType + ' Deleted');
        await this.refresh();
      });
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
