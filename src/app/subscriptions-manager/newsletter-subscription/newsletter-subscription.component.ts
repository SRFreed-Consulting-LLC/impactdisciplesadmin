import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
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
import { ColumnFilterValue, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';
import { ExcelColumn, exportToExcel } from '../../shared/table-export.util';
import { NewsletterSubscriberDialogComponent } from './newsletter-subscriber-dialog.component';
import { SendNewsletterDialogComponent } from './send-newsletter-dialog.component';
import { NewsletterListDialogComponent } from './newsletter-list-dialog.component';

interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
}

@Component({
    selector: 'app-newsletter-subscription',
    templateUrl: './newsletter-subscription.component.html',
    styleUrls: ['./newsletter-subscription.component.scss'],
    standalone: false
})
export class NewsletterSubscriptionComponent implements OnInit {
  subscribers$: Observable<NewsletterSubscriptionModel[]>;
  columns: ColumnDef[] = [
    { key: 'lastName', label: 'Last Name', visible: true },
    { key: 'firstName', label: 'First Name', visible: true },
    { key: 'email', label: 'Email', visible: true },
    { key: 'date', label: 'Date', visible: true }
  ];
  textOperators = TEXT_FILTER_OPERATORS;

  itemType = 'Newsletter Subscription';

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
  actions: ListHeaderAction[] = [];

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});
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
    this.subscribers$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) => {
        this.allSubscribers = items;
        const filtered = items
          .filter((item) => Object.keys(filters).every((field) => this.matchesField(item, field, filters[field])))
          .sort((a, b) => (a.lastName ?? '').localeCompare(b.lastName ?? ''));
        this.currentRows = filtered;
        return filtered;
      }),
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
    this.actions = actions;
  }

  private matchesField(item: NewsletterSubscriptionModel, field: string, filter: ColumnFilterValue): boolean {
    return matchesColumnFilter((item as any)[field], filter, field === 'date' ? 'date' : 'text');
  }

  get displayedColumns(): string[] {
    return ['select', ...this.columns.filter((c) => c.visible).map((c) => c.key), 'actions'];
  }

  get filterColumns(): string[] {
    return ['select-filter', ...this.columns.filter((c) => c.visible).map((c) => `${c.key}-filter`), 'actions-filter'];
  }

  toggleColumn(column: ColumnDef): void {
    column.visible = !column.visible;
  }

  exportExcel(): void {
    const visible = this.columns.filter((c) => c.visible);
    const excelColumns: ExcelColumn<NewsletterSubscriptionModel>[] = visible.map((c) => ({
      header: c.label,
      value: (item) => (item as any)[c.key] ?? ''
    }));
    exportToExcel(this.currentRows, excelColumns, 'newsletter_subscribers.xlsx');
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
  }

  onListFilterChanged(listId: string | null): void {
    this.selection.clear();

    if (listId) {
      this.selectedList = this.emailLists.find((list) => list.id === listId);
      const memberIds = new Set((this.selectedList?.list ?? []).map((s: NewsletterSubscriptionModel) => s.id));
      this.allSubscribers.filter((s) => memberIds.has(s.id)).forEach((s) => this.selection.select(s));
    } else {
      this.selectedList = { ...new EmailList() };
    }
    this.refreshActions();
  }

  isAllSelected(): boolean {
    return this.currentRows.length > 0 && this.currentRows.every((row) => this.selection.isSelected(row));
  }

  masterToggle(): void {
    this.isAllSelected() ? this.selection.clear() : this.currentRows.forEach((row) => this.selection.select(row));
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
