import { Component, OnInit } from '@angular/core';
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
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { PagedCollectionSource } from '../../shared/paged-collection-source';
import { CustomerDialogComponent } from './customer-dialog.component';
import { SendEmailDialogComponent } from './send-email-dialog.component';
import { EmailListDialogComponent } from './email-list-dialog.component';

@Component({
    selector: 'app-customers',
    templateUrl: './customers.component.html',
    styleUrls: ['./customers.component.scss'],
    standalone: false
})
export class CustomersComponent implements OnInit {
  columns: DataGridColumn<CustomerModel>[] = [
    { key: 'lastName', label: 'Last Name' },
    { key: 'firstName', label: 'First Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Number', value: (item) => item.phone?.number ?? '' }
  ];

  itemType = 'Customer';

  emailLists: EmailList[] = [];
  selectedList: EmailList | undefined;
  selection = new SelectionModel<CustomerModel>(true, []);

  rowActions: DataGridRowAction<CustomerModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item) }];

  // A stable field, not a getter - app-list-header's *ngFor keys off these
  // action objects, and a getter that returns a brand-new array (and brand
  // new object literals) on every change-detection cycle makes Angular tear
  // down and rebuild the menu-item buttons constantly, including while the
  // menu is open. That churn is what was silently swallowing clicks: live-
  // tested via Playwright, clicking "New" (or any menu action) did nothing.
  // Reassigned only when what it should show actually changes (see
  // refreshActions()).
  headerActions: ListHeaderAction[] = [];

  paged: PagedCollectionSource<CustomerModel>;

  // Deliberately NOT sourced from the paged grid (paged.rows$ only ever has
  // whatever's been scrolled into view) - Filter by List's "Save List" writes
  // exactly whatever's in `selection.selected` back to the email list, so
  // this has to be the true full set or saving a list while only a few pages
  // are loaded would silently drop every member the admin hadn't scrolled to
  // yet. One-time getAll() (not a live streamAll() subscription) is still a
  // real improvement over the old behavior - just not paginated, since
  // correctness here matters more than the read-count savings.
  private allCustomers: CustomerModel[] = [];
  private events: EventModel[] = [];

  constructor(
    private service: CustomerService,
    private eventService: EventService,
    private emailListService: EmailListService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {
    this.paged = new PagedCollectionSource<CustomerModel>(
      (pageSize, cursor) => this.service.getPage(pageSize, cursor, 'lastName', 'asc'),
      50
    );
  }

  async ngOnInit(): Promise<void> {
    // Each page already comes back ordered by lastName asc from Firestore,
    // and pages are appended in fetch order - no client-side re-sort needed.
    this.paged.loadFirstPage();

    this.service.getAll().then((customers) => {
      this.allCustomers = customers;
    });

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
    this.headerActions = actions;
  }

  onListFilterChanged(listId: string | null): void {
    this.selection.clear();

    if (listId) {
      this.selectedList = this.emailLists.find((list) => list.id === listId);
      const memberIds = new Set(((this.selectedList?.list ?? []) as CustomerModel[]).map((c) => c.id));
      this.allCustomers.filter((c) => memberIds.has(c.id)).forEach((c) => this.selection.select(c));
    } else {
      this.selectedList = { ...new EmailList() };
    }
    this.refreshActions();
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
