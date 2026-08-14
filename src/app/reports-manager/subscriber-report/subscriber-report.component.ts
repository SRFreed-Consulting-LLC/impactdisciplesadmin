import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { SubscriptionModel, SubscriptionType } from 'src/app/common/models/domain/subscription.model';
import { SubscriptionService } from 'src/app/common/services/data/subscription.service';
import { QueryParam, WhereFilterOperandKeys } from 'src/app/common/dao/firebase.dao';
import { dateFromTimestamp, toMillis } from 'src/app/common/utils/date-from-timestamp';
import { ExcelColumn, exportToExcel } from '../../shared/table-export.util';
import { DataGridColumn } from '../../shared/data-grid/data-grid.model';

interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
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
// over the subscriptions collection (see subscriptions.component.ts's own
// comment: newsletter + prayer team, merged into one collection,
// distinguished by `type`). Date Subscribed and Type are real Firestore
// queries (see criteriaForm/runQuery() below).
//
// Deliberately no "List" criterion (a saved EmailList membership filter,
// like the Subscribers screen's own "Filter by List") - considered and
// dropped: it's not a Firestore query (SubscriptionModel carries no list
// membership field of its own; membership only exists in a separately
// saved EmailList doc's `list` array, resolved client-side), and wasn't
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

  constructor(private service: SubscriptionService, private fb: FormBuilder) {
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

  // Builds one real Firestore query (date range + type, both optional -
  // unlike Purchase Report there's no OR-across-two-fields case here).
  private async runQuery(): Promise<SubscriptionModel[]> {
    const dateParams = this.criteriaForm.value.dateEnabled ? this.buildDateParams() : [];
    const typeParams = this.criteriaForm.value.typeEnabled
      ? [new QueryParam('type', WhereFilterOperandKeys.equal, this.criteriaForm.value.type)]
      : [];
    return this.service.queryAllByMultiValue([...dateParams, ...typeParams]);
  }

  private buildDateParams(): QueryParam[] {
    const { dateMode, afterDate, startDate, endDate, lastMonths } = this.criteriaForm.value;

    if (dateMode === 'after') {
      return [new QueryParam('date', WhereFilterOperandKeys.moreOrEqual, afterDate)];
    }
    if (dateMode === 'between') {
      return [
        new QueryParam('date', WhereFilterOperandKeys.moreOrEqual, startDate),
        new QueryParam('date', WhereFilterOperandKeys.lessOrEqual, endDate)
      ];
    }
    // lastMonths
    const since = new Date();
    since.setMonth(since.getMonth() - (lastMonths ?? 0));
    return [new QueryParam('date', WhereFilterOperandKeys.moreOrEqual, since)];
  }

  private toRow(item: SubscriptionModel): ReportRow {
    return {
      id: item.id!,
      firstName: item.firstName ?? '',
      lastName: item.lastName ?? '',
      email: item.email ?? '',
      typeLabel: this.typeLabel(item.type),
      date: dateFromTimestamp(item.date),
      subscriberCount: 0,
      earliestDate: null,
      latestDate: null
    };
  }

  private aggregateByType(items: SubscriptionModel[]): ReportRow[] {
    const groups = new Map<SubscriptionType, SubscriptionModel[]>();
    items.forEach((item) => {
      if (!groups.has(item.type)) {
        groups.set(item.type, []);
      }
      groups.get(item.type)!.push(item);
    });

    return Array.from(groups.entries()).map(([type, subs]) => {
      const dates = subs.map((s) => toMillis(s.date)).filter((ms) => ms > 0);
      return {
        id: type,
        firstName: '',
        lastName: '',
        email: '',
        typeLabel: this.typeLabel(type),
        date: null,
        subscriberCount: subs.length,
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
