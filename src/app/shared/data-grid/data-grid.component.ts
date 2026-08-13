import { AfterContentInit, Component, ContentChildren, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, QueryList, SimpleChanges, TemplateRef } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { SelectionModel } from '@angular/cdk/collections';
import { BehaviorSubject, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ColumnFilterValue, DATE_FILTER_OPERATORS, FilterOperatorOption, matchesColumnFilter, NUMBER_FILTER_OPERATORS, TEXT_FILTER_OPERATORS } from './column-filter/column-filter.model';
import { dateFromTimestamp, toMillis } from 'src/app/common/utils/date-from-timestamp';
import { ExcelColumn, exportToExcel } from '../table-export.util';
import { ListHeaderAction } from '../list-header/list-header.component';
import { PagedCollectionSource } from '../paged-collection-source';
import { DataGridCellDirective } from './data-grid-cell.directive';
import { DataGridColumn, DataGridRowAction } from './data-grid.model';

type SortDirection = 'asc' | 'desc' | null;

// Single reusable table for every list screen in this app - owns the
// filter row, header-click sorting, the Columns/Export-to-Excel buttons,
// and (optionally) row actions and double-click, so a screen that needs a
// data-table change (a new filter operator, a sort bug, an export tweak)
// only needs it fixed here, not in ~40 near-identical hand-rolled copies.
// Reuses column-filter.component.ts/.model.ts, table-export.util.ts,
// app-list-header, app-table-loading-overlay, and (in paged mode)
// appInfiniteScroll/app-paged-table-footer exactly as every migrated screen
// already does - this just moves the boilerplate that wired them together
// into one place.
//
// Two data-source modes, matching the two patterns already used app-wide:
//  - Static: bind [rows]="(items$ | async) ?? []" and [loading]="loading$ | async",
//    same as every streamAll()-backed screen does today.
//  - Paged: bind [pagedSource]="source" (a PagedCollectionSource this
//    component still owns/constructs) instead of [rows]/[loading] - the
//    grid drives loadNextPage() via its own infinite-scroll region and
//    renders app-paged-table-footer, same as Products/Customers/Log Messages.
//
// Filtering and sorting are owned entirely by the grid (not the caller) -
// pass raw/unfiltered rows and DataGridColumn.value()/type; the grid applies
// column-filter.model.ts's matchesColumnFilter() and either a default
// value-comparison sort or a column's own sortFn(). visibleRowsChange emits
// the filtered+sorted rows currently on screen, for the rare caller that
// needs them outside the grid (e.g. a bulk-action toolbar).
//
// Custom cell content: project one <ng-template [appDataGridCell]="key">
// per column that needs anything other than plain text (images, badges,
// computed values) - see data-grid-cell.directive.ts's own comment.
@Component({
    selector: 'app-data-grid',
    templateUrl: './data-grid.component.html',
    styleUrls: ['./data-grid.component.scss'],
    standalone: false
})
export class DataGridComponent<T> implements OnInit, OnChanges, AfterContentInit, OnDestroy {
  /** False suppresses the internal app-list-header entirely (title,
   *  headerActions, and the Columns/Export buttons with it) - for
   *  dialog-hosted mini-tables that already have their own header
   *  (e.g. app-popup-header + a standalone "New" button). */
  @Input() showHeader = true;
  @Input() title = '';
  @Input() headerActions: ListHeaderAction[] = [];
  @Input() columns: DataGridColumn<T>[] = [];
  @Input() rowActions: DataGridRowAction<T>[] = [];
  /** Extra class on the <table> element, e.g. for an existing e2e selector
   *  (table.dmms-table) written before that screen adopted this grid. */
  @Input() tableClass = '';
  /** Per-row class, e.g. NewRecordTracker's `row--new` highlight. */
  @Input() rowClass?: (row: T) => string;
  /** False suppresses the whole second (filter) header row - for the rare
   *  table with no filterable columns at all, matching its original
   *  single-header-row layout instead of a row of empty filter cells. */
  @Input() showFilterRow = true;

  /** Static mode - the full (unfiltered) row set. Ignored once [pagedSource] is set. */
  @Input() rows: T[] = [];
  /** Static mode - drives the full-table loading overlay. Ignored once [pagedSource] is set. */
  @Input() loading = false;
  /** Paged mode - see this class's own comment above. */
  @Input() pagedSource?: PagedCollectionSource<T>;

  @Input() showColumnsButton = true;
  @Input() showExportButton = true;
  @Input() exportFileName = 'export.xlsx';
  @Input() exportWorksheetName = 'Sheet1';

  /** Shown in place of the table body once loading has finished and there
   *  are zero rows (whether that's genuinely no data, or a filter that
   *  matched nothing). Every table gets a message by default - falls back
   *  to `No ${title} found.` when `title` is set, else a generic
   *  "No records found." - but pass this explicitly whenever the generic
   *  wording doesn't fit (e.g. a table scoped to one parent record: "No
   *  purchases found for this customer."). */
  @Input() emptyMessage?: string;

  /** Caller-owned selection model (same CDK SelectionModel every table
   *  already constructed by hand) - when provided, the grid renders a
   *  leading checkbox column bound directly to it (master-toggle in the
   *  header, per-row in the body). The grid never creates or replaces this
   *  itself, so the caller can keep reading/clearing selection.selected
   *  exactly as before (e.g. "Save List", "Export Selected"). */
  @Input() selection?: SelectionModel<T>;

  /** Sort applied before the user has clicked any header - most tables had
   *  an implicit default order (e.g. newest first) before adopting this
   *  grid; set both to reproduce it. Only read once, on init. */
  @Input() initialSortKey?: string;
  @Input() initialSortDirection: SortDirection = 'asc';

  /** No-ops if nothing's bound - an EventEmitter with zero subscribers is
   *  just a normal RxJS Subject, so leaving this unbound is a real "no
   *  double-click behavior", not a special case this component handles. */
  @Output() rowDoubleClick = new EventEmitter<T>();
  @Output() visibleRowsChange = new EventEmitter<T[]>();
  /** Fires after every master-toggle/row-toggle on [selection] - for
   *  callers that need a side effect on change (e.g. FAQComponent syncing
   *  event.faqList = selection.selected), since the grid owns the
   *  toggle/masterToggle methods that mutate the caller's SelectionModel. */
  @Output() selectionChange = new EventEmitter<T[]>();

  @ContentChildren(DataGridCellDirective) private cellTemplateDirectives!: QueryList<DataGridCellDirective<T>>;

  visibleRows: T[] = [];
  sortKey: string | null = null;
  sortDirection: SortDirection = null;

  readonly loading$ = new BehaviorSubject<boolean>(false);
  readonly loadingMore$ = new BehaviorSubject<boolean>(false);
  readonly hasMore$ = new BehaviorSubject<boolean>(false);

  private readonly sourceRows$ = new BehaviorSubject<T[]>([]);
  private readonly destroy$ = new Subject<void>();
  private cellTemplateMap = new Map<string, TemplateRef<{ $implicit: T }>>();
  private filters: Record<string, ColumnFilterValue> = {};

  constructor(private datePipe: DatePipe, private currencyPipe: CurrencyPipe) {}

  ngOnInit(): void {
    if (this.initialSortKey) {
      this.sortKey = this.initialSortKey;
      this.sortDirection = this.initialSortDirection ?? 'asc';
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['pagedSource'] && this.pagedSource) {
      const source = this.pagedSource;
      source.rows$.pipe(takeUntil(this.destroy$)).subscribe((rows) => this.sourceRows$.next(rows));
      source.loading$.pipe(takeUntil(this.destroy$)).subscribe((v) => this.loading$.next(v));
      source.loadingMore$.pipe(takeUntil(this.destroy$)).subscribe((v) => this.loadingMore$.next(v));
      source.hasMore$.pipe(takeUntil(this.destroy$)).subscribe((v) => this.hasMore$.next(v));
    }
    if (changes['rows'] && !this.pagedSource) {
      this.sourceRows$.next(this.rows ?? []);
    }
    if (changes['loading'] && !this.pagedSource) {
      this.loading$.next(this.loading);
    }
  }

  ngAfterContentInit(): void {
    this.rebuildCellTemplateMap();
    this.cellTemplateDirectives.changes.pipe(takeUntil(this.destroy$)).subscribe(() => this.rebuildCellTemplateMap());
    this.sourceRows$.pipe(takeUntil(this.destroy$)).subscribe((rows) => this.recompute(rows));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get resolvedEmptyMessage(): string {
    return this.emptyMessage || (this.title ? `No ${this.title} found.` : 'No records found.');
  }

  get visibleColumns(): DataGridColumn<T>[] {
    return this.columns.filter((c) => c.visible !== false);
  }

  get displayedColumnKeys(): string[] {
    let keys = this.visibleColumns.map((c) => c.key);
    if (this.selection) {
      keys = ['select', ...keys];
    }
    return this.rowActions.length ? [...keys, 'actions'] : keys;
  }

  get filterColumnKeys(): string[] {
    let keys = this.visibleColumns.map((c) => `${c.key}-filter`);
    if (this.selection) {
      keys = ['select-filter', ...keys];
    }
    return this.rowActions.length ? [...keys, 'actions-filter'] : keys;
  }

  isAllSelected(): boolean {
    return !!this.selection && this.visibleRows.length > 0 && this.visibleRows.every((row) => this.selection!.isSelected(row));
  }

  masterToggle(): void {
    if (!this.selection) {
      return;
    }
    if (this.isAllSelected()) {
      this.selection.clear();
    } else {
      this.visibleRows.forEach((row) => this.selection!.select(row));
    }
    this.selectionChange.emit(this.selection.selected);
  }

  toggleRow(row: T): void {
    if (!this.selection) {
      return;
    }
    this.selection.toggle(row);
    this.selectionChange.emit(this.selection.selected);
  }

  cellTemplateFor(key: string): TemplateRef<{ $implicit: T }> | undefined {
    return this.cellTemplateMap.get(key);
  }

  resolveValue(column: DataGridColumn<T>, row: T): unknown {
    return column.value ? column.value(row) : (row as unknown as Record<string, unknown>)[column.key];
  }

  // Formats to a final display string in TS rather than via a `| date`
  // pipe in the template, so a column whose value happens to be blank/
  // unparseable never hits DatePipe.transform()'s "unable to convert into a
  // date" throw - it just falls back to an empty cell instead.
  displayValue(column: DataGridColumn<T>, row: T): string {
    const value = this.resolveValue(column, row);
    if (value == null || value === '') {
      return '';
    }
    if (column.type === 'date') {
      const date = this.toDate(value);
      return date ? (this.datePipe.transform(date, column.dateFormat) ?? '') : String(value);
    }
    if (column.type === 'currency') {
      const num = typeof value === 'number' ? value : Number(value);
      return isNaN(num) ? '' : (this.currencyPipe.transform(num) ?? '');
    }
    return String(value);
  }

  operatorsFor(column: DataGridColumn<T>): FilterOperatorOption[] {
    return column.type === 'number' || column.type === 'currency' ? NUMBER_FILTER_OPERATORS : column.type === 'date' ? DATE_FILTER_OPERATORS : TEXT_FILTER_OPERATORS;
  }

  // matchesColumnFilter()/app-column-filter only know 'text' | 'number' |
  // 'date' - currency filters exactly like a plain number (its own operator
  // set above is already NUMBER_FILTER_OPERATORS), only the *display* differs.
  filterTypeFor(column: DataGridColumn<T>): 'text' | 'number' | 'date' {
    return column.type === 'currency' ? 'number' : (column.type ?? 'text');
  }

  visibleActionsFor(row: T): DataGridRowAction<T>[] {
    return this.rowActions.filter((action) => (action.visible ? action.visible(row) : true));
  }

  toggleColumn(column: DataGridColumn<T>): void {
    column.visible = column.visible === false;
  }

  onFilterChange(key: string, filter: ColumnFilterValue): void {
    this.filters = { ...this.filters, [key]: filter };
    this.recompute(this.sourceRows$.value);
  }

  onHeaderClick(column: DataGridColumn<T>): void {
    if (column.sortable === false) {
      return;
    }
    if (this.sortKey !== column.key) {
      this.sortKey = column.key;
      this.sortDirection = 'asc';
    } else if (this.sortDirection === 'asc') {
      this.sortDirection = 'desc';
    } else {
      this.sortKey = null;
      this.sortDirection = null;
    }
    this.recompute(this.sourceRows$.value);
  }

  onRowDoubleClick(row: T): void {
    this.rowDoubleClick.emit(row);
  }

  // No-ops in static mode (there's nothing to page in) - safe to always
  // bind from the template regardless of which mode is active.
  loadMore(): void {
    this.pagedSource?.loadNextPage();
  }

  exportExcel(): void {
    const excelColumns: ExcelColumn<T>[] = this.visibleColumns.map((column) => ({
      header: column.label,
      value: (row: T) => {
        const raw = column.exportValue ? column.exportValue(row) : this.resolveValue(column, row);
        if (raw instanceof Date || typeof raw === 'string' || typeof raw === 'number') {
          return raw;
        }
        return raw == null ? '' : String(raw);
      }
    }));
    exportToExcel(this.visibleRows, excelColumns, this.exportFileName, this.exportWorksheetName);
  }

  private rebuildCellTemplateMap(): void {
    this.cellTemplateMap.clear();
    this.cellTemplateDirectives.forEach((directive) => this.cellTemplateMap.set(directive.columnKey, directive.templateRef));
  }

  private recompute(rows: T[]): void {
    const filtered = rows.filter((row) =>
      this.visibleColumns.every((column) => {
        if (column.filterable === false) {
          return true;
        }
        const filter = this.filters[column.key];
        if (!filter) {
          return true;
        }
        return matchesColumnFilter(this.resolveValue(column, row), filter, this.filterTypeFor(column));
      })
    );

    const sortColumn = this.sortKey ? this.columns.find((c) => c.key === this.sortKey) : undefined;
    const sorted = sortColumn
      ? [...filtered].sort((a, b) => {
          const result = sortColumn.sortFn ? sortColumn.sortFn(a, b) : this.defaultCompare(this.resolveValue(sortColumn, a), this.resolveValue(sortColumn, b), sortColumn.type);
          return this.sortDirection === 'desc' ? -result : result;
        })
      : filtered;

    this.visibleRows = sorted;
    this.visibleRowsChange.emit(sorted);
  }

  private defaultCompare(a: unknown, b: unknown, type?: DataGridColumn<T>['type']): number {
    if (type === 'date') {
      // toMillis() (see date-from-timestamp.ts) handles a real Date, a
      // Firestore Timestamp, the {seconds, nanoseconds}-shaped map some
      // documents have instead, and a plain date string - covering
      // whatever shape slipped through a service's fromFirestore hook (or
      // didn't get one applied, e.g. a raw paged/subcollection read).
      return toMillis(a) - toMillis(b);
    }
    if (a instanceof Date && b instanceof Date) {
      return a.getTime() - b.getTime();
    }
    if (typeof a === 'number' && typeof b === 'number') {
      return a - b;
    }
    return String(a ?? '').localeCompare(String(b ?? ''));
  }

  // See displayValue()'s own comment on why this goes through
  // dateFromTimestamp() rather than a bare `new Date(value)` first.
  private toDate(value: unknown): Date | null {
    const result = dateFromTimestamp(value);
    if (result instanceof Date) {
      return result;
    }
    // dateFromTimestamp()'s string branch has a known bug (see toMillis()'s
    // own comment in date-from-timestamp.ts): a plain ISO date string like
    // "2026-01-30T02:00:00" that isn't wrapped in a real Timestamp falls
    // through unparsed (returned as-is) rather than becoming a Date -
    // confirmed live against real `events` documents, most of which store
    // startDate/endDate exactly that way. Same guard-at-the-call-site fix
    // toMillis() and CustomerDetailsComponent.toDate() already apply,
    // not touching the shared utility itself (too many other fromFirestore
    // hooks depend on its current behavior) - without it, every 'date'
    // column in the grid would render these as a raw technical string
    // instead of a formatted date.
    if (typeof value === 'string' || typeof value === 'number') {
      const fallback = new Date(value);
      if (!isNaN(fallback.getTime())) {
        return fallback;
      }
    }
    return null;
  }
}
