import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { CheckoutForm } from 'src/app/common/models/utils/cart.model';
import { PurchasesService } from 'src/app/common/services/data/purchases.service';
import { QueryParam, WhereFilterOperandKeys } from 'src/app/common/dao/firebase.dao';
import { EnumHelper } from 'src/app/common/utils/enum_helper';
import { dateFromTimestamp, toMillis } from 'src/app/common/utils/date-from-timestamp';
import { ExcelColumn, exportToExcel } from '../../shared/table-export.util';
import { DataGridColumn } from '../../shared/data-grid/data-grid.model';

interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
}

// Flat, report-specific row shape - not CheckoutForm itself, since a
// grouped-by-user row is a synthesized aggregate over several purchases,
// not one real document.
interface ReportRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  billingAddress1: string;
  billingAddress2: string;
  billingCity: string;
  billingState: string;
  billingZip: string;
  shippingAddress1: string;
  shippingAddress2: string;
  shippingCity: string;
  shippingState: string;
  shippingZip: string;
  dateProcessed: Date | null;
  itemsPurchased: string;
  total: number;
  processedStatus: string;
  receipt: string;
  // Grouped-mode-only - 0/blank when ungrouped.
  purchaseCount: number;
  totalSpent: number;
  lastPurchaseDate: Date | null;
}

type DateMode = 'after' | 'between' | 'lastMonths';

// Reports Manager > Purchases - a configurable report/contact-list builder
// over the purchases collection. Search criteria (Purchase Date, State) are
// real Firestore queries (see criteriaForm/generateReport() below), not a
// full-collection client-side filter - deliberately dropped the originally-
// requested "specific product(s)" criterion, since CheckoutForm.cartItems is
// an array of full line-item objects (not scalar product IDs), which
// Firestore's array-contains can't sub-field-match against - there is no
// way to make that a real query without a schema change (a denormalized
// productIds: string[] written at checkout, a separate repo - out of scope
// here, see MIGRATION.md). "Items Purchased" still shows as a display
// column - a report about purchases should still show what was bought,
// it's just not a filter dimension.
//
// KNOWN LIMITATION: ~9% of purchases.dateProcessed values in dev are
// stored as a malformed {seconds,nanoseconds} map instead of a real
// Firestore Timestamp (see MIGRATION.md's "Date fields: inconsistent
// storage shapes" entry - discovered this same session). A genuine
// Firestore range query on dateProcessed (used here) compares by Firestore's
// own value-type ordering, so those malformed documents will NOT match a
// date-range query even when their real date falls inside the range - this
// report can silently undercount for any date-filtered search. Not fixable
// from this screen; the real fix is the data migration documented in
// MIGRATION.md.
@Component({
    selector: 'app-purchase-report',
    templateUrl: './purchase-report.component.html',
    styleUrls: ['./purchase-report.component.scss'],
    standalone: false
})
export class PurchaseReportComponent {
  states: string[] = EnumHelper.getStateTypesAsArray();

  criteriaForm: FormGroup;

  columns: ColumnDef[] = [
    { key: 'firstName', label: 'First Name', visible: true },
    { key: 'lastName', label: 'Last Name', visible: true },
    { key: 'email', label: 'Email', visible: true },
    { key: 'phone', label: 'Phone', visible: true },
    { key: 'billingAddress1', label: 'Billing Address 1', visible: false },
    { key: 'billingAddress2', label: 'Billing Address 2', visible: false },
    { key: 'billingCity', label: 'Billing City', visible: false },
    { key: 'billingState', label: 'Billing State', visible: false },
    { key: 'billingZip', label: 'Billing Zip', visible: false },
    { key: 'shippingAddress1', label: 'Shipping Address 1', visible: false },
    { key: 'shippingAddress2', label: 'Shipping Address 2', visible: false },
    { key: 'shippingCity', label: 'Shipping City', visible: false },
    { key: 'shippingState', label: 'Shipping State', visible: false },
    { key: 'shippingZip', label: 'Shipping Zip', visible: false },
    { key: 'dateProcessed', label: 'Purchase Date', visible: true },
    { key: 'itemsPurchased', label: 'Items Purchased', visible: true },
    { key: 'total', label: 'Total', visible: true },
    { key: 'processedStatus', label: 'Status', visible: false },
    { key: 'receipt', label: 'Receipt', visible: false },
    // Only meaningful once groupByUser is on - see displayedColumns.
    { key: 'purchaseCount', label: 'Purchase Count', visible: true },
    { key: 'totalSpent', label: 'Total Spent', visible: true },
    { key: 'lastPurchaseDate', label: 'Most Recent Purchase', visible: false }
  ];

  groupByUser = false;

  results: ReportRow[] = [];
  loading = false;
  generated = false;
  errorMessage: string | null = null;

  constructor(private service: PurchasesService, private fb: FormBuilder) {
    this.criteriaForm = this.fb.group({
      dateEnabled: [false],
      dateMode: ['after' as DateMode],
      afterDate: [null],
      startDate: [null],
      endDate: [null],
      lastMonths: [3],
      stateEnabled: [false],
      state: [null, Validators.required]
    });
  }

  get canGenerate(): boolean {
    return this.criteriaForm.value.dateEnabled || this.criteriaForm.value.stateEnabled;
  }

  // Grouped-only columns stay out of the ungrouped table (and vice versa
  // for anything that'd just repeat the row's own values) - keeps the
  // column-picker relevant to the mode actually in use.
  get displayedColumns(): string[] {
    return this.columns
      .filter((c) => c.visible)
      .filter((c) => this.groupByUser || (c.key !== 'purchaseCount' && c.key !== 'totalSpent' && c.key !== 'lastPurchaseDate'))
      .map((c) => c.key);
  }

  toggleColumn(column: ColumnDef): void {
    column.visible = !column.visible;
  }

  columnLabel(key: string): string {
    return this.columns.find((c) => c.key === key)?.label ?? key;
  }

  // Feeds app-data-grid (rendering only - Columns/Export/the criteria form
  // stay this component's own hand-rolled app-list-header above, since this
  // screen's column visibility is two-layered: the user's own toggle AND
  // groupByUser hiding aggregate-only columns, which doesn't fit the grid's
  // single mutable Column.visible flag. Always pre-filtered to exactly what
  // should show, so [showHeader]="false" never needs to toggle these itself.
  get gridColumns(): DataGridColumn<ReportRow>[] {
    return this.displayedColumns.map((key) => this.toGridColumn(key));
  }

  private toGridColumn(key: string): DataGridColumn<ReportRow> {
    const label = this.columnLabel(key);
    if (key === 'dateProcessed' || key === 'lastPurchaseDate') {
      return { key, label, type: 'date', dateFormat: 'short', sortable: false };
    }
    if (key === 'total' || key === 'totalSpent') {
      return { key, label, type: 'currency', sortable: false };
    }
    return { key, label, sortable: false };
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
      this.results = this.groupByUser ? this.aggregateByEmail(raw) : raw.map((item) => this.toRow(item));
      this.generated = true;
    } catch (err) {
      // Firestore throws a specific "query requires an index" error (with a
      // console link to auto-create it) when the Date+State composite
      // index isn't deployed yet - surface that distinctly, since "no
      // results" and "the query itself failed" look identical otherwise.
      this.errorMessage = (err as { message?: string })?.message ?? 'Something went wrong generating the report.';
    } finally {
      this.loading = false;
    }
  }

  // Builds 1 or 2 real Firestore queries (2 only when State is enabled -
  // one against billingAddress.state, one against shippingAddress.state,
  // since a purchase matches on EITHER address - not expressible as a
  // single query) and merges+dedupes the results by id.
  private async runQuery(): Promise<CheckoutForm[]> {
    const dateParams = this.criteriaForm.value.dateEnabled ? this.buildDateParams() : [];

    if (!this.criteriaForm.value.stateEnabled) {
      return this.service.queryAllByMultiValue(dateParams);
    }

    const state = this.criteriaForm.value.state;
    const [billingResults, shippingResults] = await Promise.all([
      this.service.queryAllByMultiValue([...dateParams, new QueryParam('billingAddress.state', WhereFilterOperandKeys.equal, state)]),
      this.service.queryAllByMultiValue([...dateParams, new QueryParam('shippingAddress.state', WhereFilterOperandKeys.equal, state)])
    ]);

    const byId = new Map<string, CheckoutForm>();
    [...billingResults, ...shippingResults].forEach((item) => byId.set(item.id!, item));
    return Array.from(byId.values());
  }

  private buildDateParams(): QueryParam[] {
    const { dateMode, afterDate, startDate, endDate, lastMonths } = this.criteriaForm.value;

    if (dateMode === 'after') {
      return [new QueryParam('dateProcessed', WhereFilterOperandKeys.moreOrEqual, afterDate)];
    }
    if (dateMode === 'between') {
      return [
        new QueryParam('dateProcessed', WhereFilterOperandKeys.moreOrEqual, startDate),
        new QueryParam('dateProcessed', WhereFilterOperandKeys.lessOrEqual, endDate)
      ];
    }
    // lastMonths
    const since = new Date();
    since.setMonth(since.getMonth() - (lastMonths ?? 0));
    return [new QueryParam('dateProcessed', WhereFilterOperandKeys.moreOrEqual, since)];
  }

  private toRow(item: CheckoutForm): ReportRow {
    return {
      id: item.id!,
      firstName: item.firstName ?? '',
      lastName: item.lastName ?? '',
      email: item.email ?? '',
      phone: item.phone?.number ?? '',
      billingAddress1: item.billingAddress?.address1 ?? '',
      billingAddress2: item.billingAddress?.address2 ?? '',
      billingCity: item.billingAddress?.city ?? '',
      billingState: item.billingAddress?.state ?? '',
      billingZip: item.billingAddress?.zip ?? '',
      shippingAddress1: item.shippingAddress?.address1 ?? '',
      shippingAddress2: item.shippingAddress?.address2 ?? '',
      shippingCity: item.shippingAddress?.city ?? '',
      shippingState: item.shippingAddress?.state ?? '',
      shippingZip: item.shippingAddress?.zip ?? '',
      dateProcessed: dateFromTimestamp(item.dateProcessed),
      itemsPurchased: (item.cartItems ?? []).map((c) => c.itemName).filter(Boolean).join(', '),
      total: item.total ?? 0,
      processedStatus: item.processedStatus ?? '',
      receipt: item.receipt ?? '',
      purchaseCount: 0,
      totalSpent: 0,
      lastPurchaseDate: null
    };
  }

  private aggregateByEmail(items: CheckoutForm[]): ReportRow[] {
    const groups = new Map<string, CheckoutForm[]>();
    items.forEach((item) => {
      const key = item.email || item.id!;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(item);
    });

    return Array.from(groups.values()).map((purchases) => {
      const sorted = [...purchases].sort((a, b) => toMillis(b.dateProcessed) - toMillis(a.dateProcessed));
      const mostRecent = sorted[0];
      const row = this.toRow(mostRecent);

      const itemNames = new Set<string>();
      purchases.forEach((p) => (p.cartItems ?? []).forEach((c) => { if (c.itemName) itemNames.add(c.itemName); }));

      row.itemsPurchased = Array.from(itemNames).join(', ');
      row.purchaseCount = purchases.length;
      row.totalSpent = purchases.reduce((sum, p) => sum + (p.total ?? 0), 0);
      row.lastPurchaseDate = row.dateProcessed;
      return row;
    });
  }

  private fieldValue(row: ReportRow, key: string): unknown {
    return (row as unknown as unknown as Record<string, unknown>)[key];
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
    exportToExcel(this.results, excelColumns, 'purchase-report.xlsx');
  }
}
