import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { SelectionModel } from '@angular/cdk/collections';
import jsPDF from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { CustomerModel } from 'src/app/common/models/domain/utils/customer.model';
import { CustomerService } from 'src/app/common/services/data/customer.service';
import { EmailList } from 'src/app/common/models/utils/email-list.model';
import { EmailListService } from 'src/app/common/services/data/email-list.service';
import { EventModel } from 'src/app/common/models/domain/event.model';
import { EventService } from 'src/app/common/services/data/event.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { ColumnFilterValue, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../shared/column-filter/column-filter.model';
import { ExcelColumn, exportToExcel } from '../../shared/table-export.util';
import { CustomerDialogComponent } from './customer-dialog.component';
import { SendEmailDialogComponent } from './send-email-dialog.component';
import { EmailListDialogComponent } from './email-list-dialog.component';

interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
}

@Component({
    selector: 'app-customers',
    templateUrl: './customers.component.html',
    styleUrls: ['./customers.component.scss'],
    standalone: false
})
export class CustomersComponent implements OnInit {
  customers$: Observable<CustomerModel[]>;
  columns: ColumnDef[] = [
    { key: 'lastName', label: 'Last Name', visible: true },
    { key: 'firstName', label: 'First Name', visible: true },
    { key: 'email', label: 'Email', visible: true },
    { key: 'phone', label: 'Number', visible: true }
  ];
  textOperators = TEXT_FILTER_OPERATORS;

  itemType = 'Customer';

  emailLists: EmailList[] = [];
  selectedList: EmailList | undefined;
  selection = new SelectionModel<CustomerModel>(true, []);

  // House rule: every data table shows a loading spinner until its data
  // has actually arrived (see app-table-loading-overlay) - starts true,
  // flips to false the moment the stream first emits (even an empty
  // array), never on a timer.
  loading$ = new BehaviorSubject<boolean>(true);

  // A stable field, not a getter - app-list-header's *ngFor keys off these
  // action objects, and a getter that returns a brand-new array (and brand
  // new object literals) on every change-detection cycle makes Angular tear
  // down and rebuild the menu-item buttons constantly, including while the
  // menu is open. That churn is what was silently swallowing clicks: live-
  // tested via Playwright, clicking "New" (or any menu action) did nothing.
  // Reassigned only when what it should show actually changes (see
  // refreshActions()).
  actions: ListHeaderAction[] = [];

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});
  private currentRows: CustomerModel[] = [];
  private allCustomers: CustomerModel[] = [];
  private events: EventModel[] = [];

  constructor(
    private service: CustomerService,
    private eventService: EventService,
    private emailListService: EmailListService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  async ngOnInit(): Promise<void> {
    this.customers$ = combineLatest([this.service.streamAll(), this.filters$]).pipe(
      map(([items, filters]) => {
        this.allCustomers = items;
        const filtered = items
          .filter((item) => Object.keys(filters).every((field) => this.matchesField(item, field, filters[field])))
          .sort((a, b) => (a.lastName ?? '').localeCompare(b.lastName ?? ''));
        this.currentRows = filtered;
        return filtered;
      }),
      tap(() => this.loading$.next(false))
    );

    this.events = await this.eventService.getAll();
    this.emailLists = (await this.emailListService.getAllByValue('type', 'customer')) ?? [];
    this.refreshActions();
  }

  private refreshActions(): void {
    const actions: ListHeaderAction[] = [
      { label: 'New', icon: 'add', onClick: () => this.showAddModal() },
      { label: 'Send Email', icon: 'email', onClick: () => this.showEmailModal() },
      { label: 'Create Email List', icon: 'view_list', onClick: () => this.showListModal() },
      { label: 'Export Customer List', icon: 'picture_as_pdf', onClick: () => this.exportPdf() }
    ];
    if (this.selectedList?.name) {
      actions.push({ label: 'Save List', icon: 'save', onClick: () => this.onListSave() });
    }
    this.actions = actions;
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
    const excelColumns: ExcelColumn<CustomerModel>[] = visible.map((c) => ({
      header: c.label,
      value: (row) => (c.key === 'phone' ? row.phone?.number : (row as any)[c.key]) ?? ''
    }));
    exportToExcel(this.currentRows, excelColumns, 'customers.xlsx');
  }

  private matchesField(item: CustomerModel, field: string, filter: ColumnFilterValue): boolean {
    if (field === 'phone') {
      return matchesColumnFilter(item.phone?.number, filter, 'text');
    }
    return matchesColumnFilter((item as any)[field], filter, 'text');
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
  }

  onListFilterChanged(listId: string | null): void {
    this.selection.clear();

    if (listId) {
      this.selectedList = this.emailLists.find((list) => list.id === listId);
      const memberIds = new Set((this.selectedList?.list ?? []).map((c: CustomerModel) => c.id));
      this.allCustomers.filter((c) => memberIds.has(c.id)).forEach((c) => this.selection.select(c));
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

  // Wide enough that the Purchases tab's 10 columns (Date/Status/Receipt/
  // Coupon/Total/Taxes/Shipping/Charged/Refunded/Actions) fit without
  // needing their own horizontal scroll on typical desktop widths.
  private static readonly DIALOG_WIDTH = { width: '1200px', maxWidth: '95vw' };

  showAddModal(): void {
    this.dialog.open(CustomerDialogComponent, {
      ...CustomersComponent.DIALOG_WIDTH,
      data: { item: null, events: this.events }
    });
  }

  showEditModal(item: CustomerModel): void {
    this.dialog.open(CustomerDialogComponent, {
      ...CustomersComponent.DIALOG_WIDTH,
      data: { item, events: this.events }
    });
  }

  showEmailModal(): void {
    this.dialog.open(SendEmailDialogComponent, {
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
    const dialogRef = this.dialog.open(EmailListDialogComponent, {
      width: '480px',
      data: { item: null, members: this.selection.selected }
    });

    dialogRef.afterClosed().subscribe(async (saved) => {
      if (saved) {
        this.emailLists = (await this.emailListService.getAllByValue('type', 'customer')) ?? [];
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

  delete(item: CustomerModel): void {
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
      head: [['Last Name', 'First Name', 'Email', 'Number']],
      body: this.selection.selected.map((row) => [
        row.lastName ?? '',
        row.firstName ?? '',
        row.email ?? '',
        row.phone?.number ? `${row.phone.countryCode ? '+' + row.phone.countryCode : ''} ${row.phone.number}` : ''
      ])
    });
    doc.save('customer_list.pdf');
  }
}
