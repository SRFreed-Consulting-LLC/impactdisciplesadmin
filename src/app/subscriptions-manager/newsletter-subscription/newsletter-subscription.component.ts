import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { SelectionModel } from '@angular/cdk/collections';
import jsPDF from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { NewsletterSubscriptionModel } from 'src/app/common/models/domain/newsletter-subscription.model';
import { NewsletterSubscriptionService } from 'src/app/common/services/data/newsletter-subscription.service';
import { EmailList } from 'src/app/common/models/utils/email-list.model';
import { EmailListService } from 'src/app/common/services/data/email-list.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { NewsletterSubscriberDialogComponent } from './newsletter-subscriber-dialog.component';
import { SendNewsletterDialogComponent } from './send-newsletter-dialog.component';
import { NewsletterListDialogComponent } from './newsletter-list-dialog.component';

@Component({
    selector: 'app-newsletter-subscription',
    templateUrl: './newsletter-subscription.component.html',
    styleUrls: ['./newsletter-subscription.component.scss'],
    standalone: false
})
export class NewsletterSubscriptionComponent implements OnInit {
  subscribers$: Observable<NewsletterSubscriptionModel[]>;
  columns: DataGridColumn<NewsletterSubscriptionModel>[] = [
    { key: 'lastName', label: 'Last Name' },
    { key: 'firstName', label: 'First Name' },
    { key: 'email', label: 'Email' },
    { key: 'date', label: 'Date', type: 'date', filterable: false }
  ];

  itemType = 'Newsletter Subscription';

  rowActions: DataGridRowAction<NewsletterSubscriptionModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item) }];

  emailLists: EmailList[] = [];
  selectedList: EmailList | undefined;
  selection = new SelectionModel<NewsletterSubscriptionModel>(true, []);

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  // Stable field, not a getter - see customers.component.ts's own comment on
  // why: app-list-header's *ngFor keys off these action objects, and a
  // getter re-creating them every change-detection cycle silently swallows
  // clicks while a menu is open.
  headerActions: ListHeaderAction[] = [];

  currentRows: NewsletterSubscriptionModel[] = [];
  private allSubscribers: NewsletterSubscriptionModel[] = [];

  constructor(
    private service: NewsletterSubscriptionService,
    private emailListService: EmailListService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  async ngOnInit(): Promise<void> {
    this.subscribers$ = this.service.streamAll().pipe(
      tap((items) => (this.allSubscribers = items)),
      tap(() => this.loading$.next(false))
    );

    this.emailLists = (await this.emailListService.getAllByValue('type', 'newsletter')) ?? [];
    this.refreshActions();
  }

  private refreshActions(): void {
    const actions: ListHeaderAction[] = [
      { label: 'New', icon: 'add', onClick: () => this.showAddModal() },
      { label: 'Send Newsletter', icon: 'email', onClick: () => this.showNewsletterModal() },
      { label: 'Create Subscriber List', icon: 'view_list', onClick: () => this.showListModal() },
      { label: 'Export Subscriber List', icon: 'picture_as_pdf', onClick: () => this.exportPdf() }
    ];
    if (this.selectedList?.name) {
      actions.push({ label: 'Save List', icon: 'save', onClick: () => this.onListSave() });
    }
    this.headerActions = actions;
  }

  // Backs "Export Subscriber List" (selected-only PDF) - kept in sync via
  // (visibleRowsChange) since the grid now owns filtering/sorting.
  onVisibleRowsChange(rows: NewsletterSubscriptionModel[]): void {
    this.currentRows = rows;
  }

  onListFilterChanged(listId: string | null): void {
    this.selection.clear();

    if (listId) {
      this.selectedList = this.emailLists.find((list) => list.id === listId);
      const memberIds = new Set(((this.selectedList?.list ?? []) as NewsletterSubscriptionModel[]).map((s) => s.id));
      this.allSubscribers.filter((s) => memberIds.has(s.id)).forEach((s) => this.selection.select(s));
    } else {
      this.selectedList = { ...new EmailList() };
    }
    this.refreshActions();
  }

  showAddModal(): void {
    this.dialog.open(NewsletterSubscriberDialogComponent, {
      width: '500px',
      data: { item: null }
    });
  }

  showEditModal(item: NewsletterSubscriptionModel): void {
    this.dialog.open(NewsletterSubscriberDialogComponent, {
      width: '500px',
      data: { item }
    });
  }

  showNewsletterModal(): void {
    this.dialog.open(SendNewsletterDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      data: { selectedList: this.selectedList }
    });
  }

  showListModal(): void {
    // Always starts a brand new list from whatever rows are currently
    // checked - matches the original, which reset selectedList here
    // regardless of any list currently active in the "Filter by List" filter.
    this.selectedList = { ...new EmailList() };
    this.refreshActions();
    const dialogRef = this.dialog.open(NewsletterListDialogComponent, {
      width: '480px',
      data: { item: null, members: this.selection.selected }
    });

    dialogRef.afterClosed().subscribe(async (saved) => {
      if (saved) {
        this.emailLists = (await this.emailListService.getAllByValue('type', 'newsletter')) ?? [];
      }
    });
  }

  onListSave(): void {
    if (!this.selectedList?.id) {
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

  delete(item: NewsletterSubscriptionModel): void {
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
    doc.save('Newsletter_subscribers.pdf');
  }
}
