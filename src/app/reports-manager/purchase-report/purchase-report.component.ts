import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { CheckoutForm, FulfillmentStatus } from '@impact-common/shared/models/utils/cart.model';
import { PurchasesService } from 'src/app/common/services/data/purchases.service';
import { QueryParam, WhereFilterOperandKeys } from 'src/app/common/dao/firebase.dao';
import { EnumHelper } from '@impact-common/shared/utils/enum_helper';
import { dateFromTimestamp } from '@impact-common/shared/utils/date-from-timestamp';
import { stateVariants } from 'src/app/common/utils/state-variants';
import { DataGridColumn } from '../../shared/data-grid/data-grid.model';
import { ReportColumn, ReportColumnSet } from '../report-column-set';
import { FULFILLMENT_STEPS } from '../../contacts-manager/fulfillment/fulfillment-steps';

// Flat, report-specific row shape - not CheckoutForm itself.
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
  fulfillmentStatusLabel: string;
  receipt: string;
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

  readonly columnSet = new ReportColumnSet<ReportRow>([
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
    { key: 'dateProcessed', label: 'Purchase Date', visible: true, type: 'date', dateFormat: 'short' },
    { key: 'itemsPurchased', label: 'Items Purchased', visible: true },
    { key: 'total', label: 'Total', visible: true, type: 'currency' },
    { key: 'fulfillmentStatusLabel', label: 'Status', visible: false },
    { key: 'receipt', label: 'Receipt', visible: false }
  ]);

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

// Column visibility, grid columns and Excel export all live in
  // ReportColumnSet (sweep P1) - these stay as members so the template
  // bindings are unchanged.
  get columns(): ReportColumn[] {
    return this.columnSet.all;
  }

  get displayedColumns(): string[] {
    return this.columnSet.displayedColumns;
  }

  toggleColumn(column: ReportColumn): void {
    this.columnSet.toggleColumn(column);
  }

  columnLabel(key: string): string {
    return this.columnSet.columnLabel(key);
  }

  get gridColumns(): DataGridColumn<ReportRow>[] {
    return this.columnSet.gridColumns;
  }

  exportExcel(): void {
    void this.columnSet.exportExcel(this.results, 'purchase-report.xlsx');
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
      this.results = raw.map((item) => this.toRow(item));
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

    // Crossed with stateVariants() so a picker offering "Georgia" also
    // matches records stored as "GA". Purchases are 99.8% full names today,
    // so this changes almost nothing HERE - but it keeps the two reports
    // behaving identically, and the 4 records that do use codes stop being
    // invisible. Same composite index serves every variant: the shape
    // (state ==, dateProcessed range) is unchanged, only the value differs.
    const variants = stateVariants(this.criteriaForm.value.state);
    const results = await Promise.all(
      variants.flatMap((value) => [
        this.service.queryAllByMultiValue([...dateParams, new QueryParam('billingAddress.state', WhereFilterOperandKeys.equal, value)]),
        this.service.queryAllByMultiValue([...dateParams, new QueryParam('shippingAddress.state', WhereFilterOperandKeys.equal, value)])
      ])
    );

    const byId = new Map<string, CheckoutForm>();
    results.flat().forEach((item) => byId.set(item.id!, item));
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

  // Same label lookup as purchases.component.ts's own
  // getFulfillmentStatusLabel().
  private getFulfillmentStatusLabel(status: FulfillmentStatus | undefined): string {
    return FULFILLMENT_STEPS.find((s) => s.status === status)?.statusLabel ?? 'Unknown';
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
      dateProcessed: dateFromTimestamp(item.dateProcessed) as Date,
      itemsPurchased: (item.cartItems ?? []).map((c) => c.itemName).filter(Boolean).join(', '),
      total: item.total ?? 0,
      fulfillmentStatusLabel: this.getFulfillmentStatusLabel(item.fulfillmentStatus),
      receipt: item.receipt ?? ''
    };
  }

}
