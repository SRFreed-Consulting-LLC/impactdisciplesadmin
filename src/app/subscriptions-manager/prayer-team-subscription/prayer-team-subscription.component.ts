import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { SelectionModel } from '@angular/cdk/collections';
import jsPDF from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { PrayerTeamSubscriptionModel } from 'src/app/common/models/domain/prayer-team-subscription.model';
import { PrayerTeamSubscriptionService } from 'src/app/common/services/data/prayer-team-subscription.service';
import { EmailList } from 'src/app/common/models/utils/email-list.model';
import { EmailListService } from 'src/app/common/services/data/email-list.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { PrayerSubscriberDialogComponent } from './prayer-subscriber-dialog.component';
import { SendPrayerDialogComponent } from './send-prayer-dialog.component';
import { PrayerListDialogComponent } from './prayer-list-dialog.component';

@Component({
    selector: 'app-prayer-team-subscription',
    templateUrl: './prayer-team-subscription.component.html',
    styleUrls: ['./prayer-team-subscription.component.css'],
    standalone: false
})
export class PrayerTeamSubscriptionComponent implements OnInit {
  subscribers$: Observable<PrayerTeamSubscriptionModel[]>;
  columns: DataGridColumn<PrayerTeamSubscriptionModel>[] = [
    { key: 'lastName', label: 'Last Name' },
    { key: 'firstName', label: 'First Name' },
    { key: 'email', label: 'Email' },
    { key: 'date', label: 'Date', type: 'date', filterable: false }
  ];

  itemType = 'Prayer Team Subscription';

  private readonly screenKey = 'subscriptions-manager.prayer-team';

  rowActions: DataGridRowAction<PrayerTeamSubscriptionModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item), visible: () => this.permissionService.canDelete(this.screenKey) }];

  emailLists: EmailList[] = [];
  selectedList: EmailList | undefined;
  selection = new SelectionModel<PrayerTeamSubscriptionModel>(true, []);

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  // Stable field, not a getter - see customers.component.ts's own comment on
  // why.
  headerActions: ListHeaderAction[] = [];

  currentRows: PrayerTeamSubscriptionModel[] = [];
  private allSubscribers: PrayerTeamSubscriptionModel[] = [];

  constructor(
    private service: PrayerTeamSubscriptionService,
    private emailListService: EmailListService,
    private permissionService: PermissionService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  async ngOnInit(): Promise<void> {
    this.subscribers$ = this.service.streamAll().pipe(
      tap((items) => (this.allSubscribers = items)),
      tap(() => this.loading$.next(false))
    );

    this.emailLists = (await this.emailListService.getAllByValue('type', 'prayer')) ?? [];
    this.refreshActions();
  }

  private refreshActions(): void {
    const canAdd = this.permissionService.canAdd(this.screenKey);
    const canEdit = this.permissionService.canEdit(this.screenKey);

    const actions: ListHeaderAction[] = [
      ...(canAdd ? [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }] : []),
      // Sending a prayer request and building/saving a list both mutate
      // existing data rather than create a subscriber record, so they're
      // gated by edit rather than add. Exporting is a read-only client-side
      // dump of what's already on screen - no extra gate.
      ...(canEdit ? [{ label: 'Send Prayer Request', icon: 'volunteer_activism', onClick: () => this.showPrayerModal() }] : []),
      ...(canEdit ? [{ label: 'Create Prayer List', icon: 'view_list', onClick: () => this.showListModal() }] : []),
      { label: 'Export Prayer List', icon: 'picture_as_pdf', onClick: () => this.exportPdf() }
    ];
    if (this.selectedList?.name && canEdit) {
      actions.push({ label: 'Save List', icon: 'save', onClick: () => this.onListSave() });
    }
    this.headerActions = actions;
  }

  // Backs "Export Prayer List" (selected-only PDF) - kept in sync via
  // (visibleRowsChange) since the grid now owns filtering/sorting.
  onVisibleRowsChange(rows: PrayerTeamSubscriptionModel[]): void {
    this.currentRows = rows;
  }

  onListFilterChanged(listId: string | null): void {
    this.selection.clear();

    if (listId) {
      this.selectedList = this.emailLists.find((list) => list.id === listId);
      const memberIds = new Set(((this.selectedList?.list ?? []) as PrayerTeamSubscriptionModel[]).map((s) => s.id));
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
    this.dialog.open(PrayerSubscriberDialogComponent, {
      width: '500px',
      data: { item: null }
    });
  }

  showEditModal(item: PrayerTeamSubscriptionModel): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.dialog.open(PrayerSubscriberDialogComponent, {
      width: '500px',
      data: { item }
    });
  }

  showPrayerModal(): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.dialog.open(SendPrayerDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      data: { selectedList: this.selectedList }
    });
  }

  showListModal(): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    // Always starts a brand new list from whatever rows are currently
    // checked - matches the original.
    this.selectedList = { ...new EmailList() };
    this.refreshActions();
    const dialogRef = this.dialog.open(PrayerListDialogComponent, {
      width: '480px',
      data: { item: null, members: this.selection.selected }
    });

    dialogRef.afterClosed().subscribe(async (saved) => {
      if (saved) {
        this.emailLists = (await this.emailListService.getAllByValue('type', 'prayer')) ?? [];
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

  delete(item: PrayerTeamSubscriptionModel): void {
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
      head: [['Last Name', 'First Name', 'Email', 'Date']],
      body: this.selection.selected.map((row) => [row.lastName ?? '', row.firstName ?? '', row.email ?? '', row.date instanceof Date ? row.date.toLocaleDateString() : ''])
    });
    doc.save('Prayer_team_subscribers.pdf');
  }
}
