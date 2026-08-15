import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { CustomerModel, SubscriptionType, subscriptionFieldsForType } from 'src/app/common/models/domain/utils/customer.model';
import { CustomerService } from 'src/app/common/services/data/customer.service';
import { QueryParam, WhereFilterOperandKeys } from 'src/app/common/dao/firebase.dao';
import { dateFromTimestamp, toMillis } from 'src/app/common/utils/date-from-timestamp';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ExcelColumn, exportToExcel } from '../../shared/table-export.util';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { ReportRow, SubscriberQueryRow } from './subscriber-report-row.model';
import { SubscriberDialogComponent } from './subscriber-dialog.component';
import { SendSubscriptionDialogComponent } from './send-subscription-dialog.component';

interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
}

type DateMode = 'after' | 'between' | 'lastMonths';

// Reports Manager > Subscribers - a configurable report/contact-list builder
// over the `customers` collection's 2 subscription flags (see
// customer.model.ts's own comment: newsletter + prayer team subscriber
// state used to be its own `subscriptions` collection, now it's just
// subscribedToNewsletter/subscribedToPrayerTeam booleans + dates on a
// customer). Date Subscribed and Type are real Firestore queries (see
// runQuery() below) - Type picks which flag/date-field pair to query
// (`customers` has no single `type` field to filter on any more, so
// "either type" means running the query twice, once per flag, and merging -
// same OR-across-two-fields pattern Purchase Report already uses for
// State, see this app's CLAUDE.md).
//
// Absorbed the old standalone Subscribers screen (customers-manager/
// subscriptions/, removed 2026-08-15) rather than leaving it as a separate
// list screen once subscriber management became "just a filtered view of
// customers" - Add/Edit a subscriber, Send Newsletter/Send Prayer Request,
// and unsubscribing all live here now. Deliberately NOT ported: selection
// checkboxes, "Filter by List", and building/saving an EmailList - the old
// screen supported carving subscribers into saved sub-lists, but that's
// not a thing this app does (per the user, explicitly) - every send always
// targets every subscriber with that flag (see SendSubscriptionDialogComponent),
// full stop, no per-send audience narrowing.
@Component({
    selector: 'app-subscriber-report',
    templateUrl: './subscriber-report.component.html',
    styleUrls: ['./subscriber-report.component.scss'],
    standalone: false
})
export class SubscriberReportComponent {
  criteriaForm: FormGroup;

  columns: ColumnDef[] = [
    { key: 'firstName', label: 'First Name', visible: true },
    { key: 'lastName', label: 'Last Name', visible: true },
    { key: 'email', label: 'Email', visible: true },
    { key: 'typeLabel', label: 'Type', visible: true },
    { key: 'date', label: 'Date Subscribed', visible: true },
    // Only meaningful once groupByType is on - see displayedColumns.
    { key: 'subscriberCount', label: 'Subscriber Count', visible: true },
    { key: 'earliestDate', label: 'Earliest Subscribed', visible: false },
    { key: 'latestDate', label: 'Most Recent Subscribed', visible: false }
  ];

  groupByType = false;

  results: ReportRow[] = [];
  loading = false;
  generated = false;
  errorMessage: string | null = null;

  private readonly itemType = 'Subscriber';
  private readonly screenKey = 'reports-manager.subscribers';

  rowActions: DataGridRowAction<ReportRow>[] = [
    {
      icon: 'unsubscribe',
      tooltip: 'UNSUBSCRIBE',
      onClick: (row) => this.unsubscribe(row),
      // Never true for a grouped aggregate row (no backing customer) - see
      // ReportRow's own comment.
      visible: (row) => !!row.customer && this.permissionService.canDelete(this.screenKey)
    }
  ];

  constructor(
    private service: CustomerService,
    private permissionService: PermissionService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService,
    private fb: FormBuilder
  ) {
    this.criteriaForm = this.fb.group({
      dateEnabled: [false],
      dateMode: ['after' as DateMode],
      afterDate: [null],
      startDate: [null],
      endDate: [null],
      lastMonths: [3],
      typeEnabled: [false],
      type: [null, Validators.required]
    });
  }

  get canGenerate(): boolean {
    return this.criteriaForm.value.dateEnabled || this.criteriaForm.value.typeEnabled;
  }

  canAdd(): boolean {
    return this.permissionService.canAdd(this.screenKey);
  }

  canEdit(): boolean {
    return this.permissionService.canEdit(this.screenKey);
  }

  // Grouped-only columns (a type-level aggregate) stay out of the ungrouped
  // table (each row there is one real subscriber) and vice versa - same
  // idea as purchase-report.component.ts's own displayedColumns, just with
  // identity columns (name/email/date) as the "ungrouped-only" side instead
  // of "grouped-only", since here a group ISN'T one person, it's a category.
  get displayedColumns(): string[] {
    const groupedOnlyKeys = ['subscriberCount', 'earliestDate', 'latestDate'];
    const ungroupedOnlyKeys = ['firstName', 'lastName', 'email', 'date'];
    return this.columns
      .filter((c) => c.visible)
      .filter((c) => (this.groupByType ? !ungroupedOnlyKeys.includes(c.key) : !groupedOnlyKeys.includes(c.key)))
      .map((c) => c.key);
  }

  toggleColumn(column: ColumnDef): void {
    column.visible = !column.visible;
  }

  columnLabel(key: string): string {
    return this.columns.find((c) => c.key === key)?.label ?? key;
  }

  get gridColumns(): DataGridColumn<ReportRow>[] {
    return this.displayedColumns.map((key) => this.toGridColumn(key));
  }

  private toGridColumn(key: string): DataGridColumn<ReportRow> {
    const label = this.columnLabel(key);
    if (key === 'date' || key === 'earliestDate' || key === 'latestDate') {
      return { key, label, type: 'date', dateFormat: 'short', sortable: false };
    }
    if (key === 'subscriberCount') {
      return { key, label, type: 'number', sortable: false };
    }
    return { key, label, sortable: false };
  }

  typeLabel(type: SubscriptionType): string {
    return type === 'prayer' ? 'Prayer Team' : 'Newsletter';
  }

  async generateReport(): Promise<void> {
    if (!this.canGenerate) {
      return;
    }

    this.loading = true;
    this.generated = false;
    this.errorMessage = null;

    try {
      const raw = await this.runQuery();
      this.results = this.groupByType ? this.aggregateByType(raw) : raw.map((item) => this.toRow(item));
      this.generated = true;
    } catch (err) {
      this.errorMessage = (err as { message?: string })?.message ?? 'Something went wrong generating the report.';
    } finally {
      this.loading = false;
    }
  }

  // One real Firestore query per candidate type (just the chosen one when
  // Type is enabled, both when it isn't - see this file's own header
  // comment on why "either type" can't be a single query any more), each
  // filtered by that type's flag (always) and date range (when enabled),
  // against that type's own date field.
  private async runQuery(): Promise<SubscriberQueryRow[]> {
    const { typeEnabled, type } = this.criteriaForm.value as { typeEnabled: boolean; type: SubscriptionType | null };
    const types: SubscriptionType[] = typeEnabled && type ? [type] : ['newsletter', 'prayer'];
    const perType = await Promise.all(types.map((t) => this.queryForType(t)));
    return perType.flat();
  }

  private async queryForType(type: SubscriptionType): Promise<SubscriberQueryRow[]> {
    const { flagField, dateField } = subscriptionFieldsForType(type);
    const params: QueryParam[] = [new QueryParam(flagField, WhereFilterOperandKeys.equal, true)];
    if (this.criteriaForm.value.dateEnabled) {
      params.push(...this.buildDateParams(dateField));
    }
    const customers = await this.service.queryAllByMultiValue(params);
    return customers.map((customer) => ({ customer, type }));
  }

  private buildDateParams(field: string): QueryParam[] {
    const { dateMode, afterDate, startDate, endDate, lastMonths } = this.criteriaForm.value;

    if (dateMode === 'after') {
      return [new QueryParam(field, WhereFilterOperandKeys.moreOrEqual, afterDate)];
    }
    if (dateMode === 'between') {
      return [
        new QueryParam(field, WhereFilterOperandKeys.moreOrEqual, startDate),
        new QueryParam(field, WhereFilterOperandKeys.lessOrEqual, endDate)
      ];
    }
    // lastMonths
    const since = new Date();
    since.setMonth(since.getMonth() - (lastMonths ?? 0));
    return [new QueryParam(field, WhereFilterOperandKeys.moreOrEqual, since)];
  }

  private toRow(item: SubscriberQueryRow): ReportRow {
    const { dateField } = subscriptionFieldsForType(item.type);
    return {
      id: `${item.customer.id}:${item.type}`,
      type: item.type,
      firstName: item.customer.firstName ?? '',
      lastName: item.customer.lastName ?? '',
      email: item.customer.email ?? '',
      typeLabel: this.typeLabel(item.type),
      date: dateFromTimestamp(item.customer[dateField]),
      subscriberCount: 0,
      earliestDate: null,
      latestDate: null,
      customer: item.customer
    };
  }

  private aggregateByType(items: SubscriberQueryRow[]): ReportRow[] {
    const groups = new Map<SubscriptionType, SubscriberQueryRow[]>();
    items.forEach((item) => {
      if (!groups.has(item.type)) {
        groups.set(item.type, []);
      }
      groups.get(item.type)!.push(item);
    });

    return Array.from(groups.entries()).map(([type, rows]) => {
      const { dateField } = subscriptionFieldsForType(type);
      const dates = rows.map((r) => toMillis(r.customer[dateField])).filter((ms) => ms > 0);
      return {
        id: type,
        type,
        firstName: '',
        lastName: '',
        email: '',
        typeLabel: this.typeLabel(type),
        date: null,
        subscriberCount: rows.length,
        earliestDate: dates.length ? new Date(Math.min(...dates)) : null,
        latestDate: dates.length ? new Date(Math.max(...dates)) : null
        // No `customer` - this row doesn't correspond to any single document.
      };
    });
  }

  // ---- Add / Edit ----

  showAddModal(): void {
    if (!this.canAdd()) {
      return;
    }
    const dialogRef = this.dialog.open(SubscriberDialogComponent, {
      width: '500px',
      data: { item: null }
    });
    dialogRef.afterClosed().subscribe(async (saved) => {
      if (saved) {
        await this.generateReport();
      }
    });
  }

  // No-ops for a grouped aggregate row (no backing customer) - matches
  // rowActions' own visible() guard above.
  showEditModal(item: ReportRow): void {
    if (!item.customer || !this.canEdit()) {
      return;
    }
    const dialogRef = this.dialog.open(SubscriberDialogComponent, {
      width: '500px',
      data: { item: item as ReportRow & { customer: CustomerModel } }
    });
    dialogRef.afterClosed().subscribe(async (saved) => {
      if (saved) {
        await this.generateReport();
      }
    });
  }

  // ---- Send ----

  // Always targets every subscriber currently flagged for this type - see
  // SendSubscriptionDialogComponent, which queries that fresh itself rather
  // than reading `results` (this report's criteria are for viewing/
  // exporting, not for narrowing who a send reaches).
  showSendModal(type: SubscriptionType): void {
    if (!this.canEdit()) {
      return;
    }
    this.dialog.open(SendSubscriptionDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      data: { type }
    });
  }

  // ---- Unsubscribe ----

  // Clears just this row's flag on the underlying customer (leaving the
  // *SubscribedDate field alone - "last subscribed", not "currently
  // subscribed since", see customer.model.ts) rather than deleting the
  // customer record itself, which may carry real purchase/order history
  // completely unrelated to this subscription. Same behavior as the public
  // unsubscribe link (functions/src/subscriptions.functions.ts's
  // unsubscribe_from_email_list), just triggered from the admin side.
  unsubscribe(item: ReportRow): void {
    if (!item.customer || !this.permissionService.canDelete(this.screenKey)) {
      return;
    }
    const customer = item.customer;
    this.confirmService.confirm('<i>Are you sure you want to unsubscribe this record?</i>', 'Confirm').then((confirmed) => {
      if (!confirmed) {
        return;
      }
      const { flagField } = subscriptionFieldsForType(item.type);
      this.service.update(customer.id!, { ...customer, [flagField]: false }).then(async () => {
        this.snackbar.success(this.itemType + ' Unsubscribed');
        await this.generateReport();
      });
    });
  }

  // ---- Export ----

  private fieldValue(row: ReportRow, key: string): unknown {
    return (row as unknown as Record<string, unknown>)[key];
  }

  exportExcel(): void {
    const visibleKeys = this.displayedColumns;
    const excelColumns: ExcelColumn<ReportRow>[] = visibleKeys.map((key) => ({
      header: this.columnLabel(key),
      value: (row): string | number | Date => {
        const value = this.fieldValue(row, key);
        if (value instanceof Date || typeof value === 'string' || typeof value === 'number') {
          return value;
        }
        return value == null ? '' : String(value);
      }
    }));
    exportToExcel(this.results, excelColumns, 'subscriber-report.xlsx');
  }
}
