import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { CustomerModel, SubscriptionType, subscriptionFieldsForType } from 'src/app/common/models/domain/utils/customer.model';
import { CustomerService } from 'src/app/common/services/data/customer.service';
import { QueryParam, WhereFilterOperandKeys } from 'src/app/common/dao/firebase.dao';
import { dateFromTimestamp, toMillis } from 'src/app/common/utils/date-from-timestamp';
import { ExcelColumn, exportToExcel } from '../../shared/table-export.util';
import { DataGridColumn } from '../../shared/data-grid/data-grid.model';

interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
}

// Intermediate shape runQuery() produces - a customer + which flag matched
// it - kept separate from the final flat ReportRow below so aggregateByType
// still has a real `type` to group on (ReportRow only carries the display
// label).
interface SubscriberQueryRow {
  customer: CustomerModel;
  type: SubscriptionType;
}

// Flat, report-specific row shape - see purchase-report.component.ts's own
// comment on why (identical reasoning: a "Group by Type" row is a
// synthesized aggregate over several subscribers, not one real document).
interface ReportRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  typeLabel: string;
  date: Date | null;
  // Grouped-mode-only - blank/0 when ungrouped.
  subscriberCount: number;
  earliestDate: Date | null;
  latestDate: Date | null;
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
// "either type" now means running the query twice, once per flag, and
// merging - same OR-across-two-fields pattern Purchase Report already uses
// for State, see this app's CLAUDE.md).
//
// Deliberately no "List" criterion (a saved EmailList membership filter,
// like the Subscribers screen's own "Filter by List") - considered and
// dropped: membership only exists in a separately saved EmailList doc's
// `list` array, resolved client-side, not a Firestore query, and wasn't
// worth the extra criterion for how rarely a report needs to be scoped to
// one specific saved list rather than a type/date range.
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

  constructor(private service: CustomerService, private fb: FormBuilder) {
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
      firstName: item.customer.firstName ?? '',
      lastName: item.customer.lastName ?? '',
      email: item.customer.email ?? '',
      typeLabel: this.typeLabel(item.type),
      date: dateFromTimestamp(item.customer[dateField]),
      subscriberCount: 0,
      earliestDate: null,
      latestDate: null
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
        firstName: '',
        lastName: '',
        email: '',
        typeLabel: this.typeLabel(type),
        date: null,
        subscriberCount: rows.length,
        earliestDate: dates.length ? new Date(Math.min(...dates)) : null,
        latestDate: dates.length ? new Date(Math.max(...dates)) : null
      };
    });
  }

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
