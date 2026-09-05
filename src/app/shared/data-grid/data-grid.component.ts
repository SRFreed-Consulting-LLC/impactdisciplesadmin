import { AfterContentInit, AfterViewInit, Component, ContentChildren, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, QueryList, SimpleChanges, TemplateRef, ViewChild } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { SelectionModel } from '@angular/cdk/collections';
import { BehaviorSubject, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ColumnFilterValue, DATE_FILTER_OPERATORS, FilterOperatorOption, matchesColumnFilter, NUMBER_FILTER_OPERATORS, TEXT_FILTER_OPERATORS } from './column-filter/column-filter.model';
import { dateFromTimestamp, toMillis } from '@impact-common/shared/utils/date-from-timestamp';
import { ExcelColumn, exportToExcel } from '../table-export.util';
import { ListHeaderAction } from '../list-header/list-header.component';
import { PagedCollectionSource } from '../paged-collection-source';
import { BaseModel } from '@impact-common/shared/models/base.model';
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
export class DataGridComponent<T> implements OnInit, OnChanges, AfterContentInit, AfterViewInit, OnDestroy {
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
  /** Paged mode - see this class's own comment above. The source pages by
   *  document id, so only rows that ARE documents can be paged; static-mode
   *  rows (report rows, licence rows, tiers keyed by count) need no id. */
  @Input() pagedSource?: PagedCollectionSource<T & BaseModel>;

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
  /** Single-click on a row. Same "unbound means no behavior" contract as
   *  rowDoubleClick above. Row action buttons stopPropagation, so clicking
   *  an icon never also counts as a row click. */
  @Output() rowClick = new EventEmitter<T>();
  /** Fires after every master-toggle/row-toggle on [selection] - for
   *  callers that need a side effect on change (e.g. FAQComponent syncing
   *  event.faqList = selection.selected), since the grid owns the
   *  toggle/masterToggle methods that mutate the caller's SelectionModel. */
  @Output() selectionChange = new EventEmitter<T[]>();

  /**
   * Lets staff drag rows into a new order instead of typing a number.
   *
   * OFF by default, so every existing grid is untouched. Set it to the
   * column key that holds the order (e.g. 'order') - the grid needs to know
   * which sort counts as "the running order", because dragging is only
   * meaningful while the rows are shown in it.
   */
  @Input() reorderBy?: string;

  /**
   * The full row list in its new order, after a drag. The caller persists
   * it - the grid does not know how a row is saved.
   */
  @Output() rowsReordered = new EventEmitter<T[]>();

  /**
   * Whether a drag would currently mean anything.
   *
   * Dragging row 3 above row 1 while the table is sorted by Title, or while
   * a filter hides half the rows, would write an order derived from a view
   * that is not the running order - silently wrong in a way nobody would
   * catch. So the grip is disabled unless the table is showing every row in
   * the order column, ascending.
   */
  get canReorder(): boolean {
    if (!this.reorderBy) {
      return false;
    }
    const filtered = Object.values(this.filters).some((filter) => !!filter);
    return !filtered && this.sortKey === this.reorderBy && this.sortDirection === 'asc';
  }

  /** Says WHY the grip is disabled, rather than leaving it inert. */
  get reorderBlockedReason(): string {
    if (Object.values(this.filters).some((filter) => !!filter)) {
      return 'Clear the column filters to drag rows into a new order';
    }
    return 'Sort by ' + this.orderColumnLabel + ' (ascending) to drag rows into a new order';
  }

  private get orderColumnLabel(): string {
    return this.columns.find((column) => column.key === this.reorderBy)?.label ?? 'order';
  }

  /**
   * Moves a row and hands the caller the whole list in its new order.
   *
   * The grid deliberately does NOT write the order field - it does not know
   * what the field is called on the model, only which column displays it.
   */
  onRowDropped(previousIndex: number, currentIndex: number): void {
    if (!this.canReorder || previousIndex === currentIndex) {
      return;
    }
    const rows = [...this.visibleRows];
    const [moved] = rows.splice(previousIndex, 1);
    rows.splice(currentIndex, 0, moved);
    this.visibleRows = rows;
    this.rowsReordered.emit(rows);
  }

  @ContentChildren(DataGridCellDirective) private cellTemplateDirectives!: QueryList<DataGridCellDirective<T>>;

  @ViewChild('tableScroll') private tableScroll?: ElementRef<HTMLElement>;

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

  /** How many animation frames restoreScroll() will re-assert the offset for
   *  while the table finishes laying out. Ten is ~160ms at 60fps - long
   *  enough for a 50-row page with images, short enough that a list which
   *  genuinely cannot reach the offset gives up rather than spinning. */
  private static readonly SCROLL_RESTORE_FRAMES = 10;

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

  ngAfterViewInit(): void {
    this.restoreScroll();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Records where the list is scrolled to, so a screen that switches to an
   * edit view (every one of them does it with @if, which unmounts this
   * component) can come back to the same place instead of the top.
   *
   * Cheap enough to run on every scroll event: it reads one number and
   * assigns it. Change detection is already running on this element anyway -
   * InfiniteScrollDirective has had a @HostListener('scroll') on it since
   * paging was introduced - so this adds no zone work that was not happening.
   */
  rememberScroll(): void {
    const element = this.tableScroll?.nativeElement;
    if (element && this.pagedSource) {
      this.pagedSource.scrollTop = element.scrollTop;
    }
  }

  /**
   * Puts the offset back after a re-mount. No-ops on a first mount, where
   * the remembered offset is still 0.
   *
   * The retry matters. Assigning scrollTop is clamped to the element's
   * CURRENT scrollHeight, and on the frame this runs the table may not have
   * laid out its rows yet - the assignment silently lands short, leaving the
   * admin part-way up the list, which looks like the bug it is meant to fix.
   * Re-asserting for a few frames costs nothing and stops once the offset
   * sticks or the rows genuinely are not that tall any more (a page reload
   * with fewer rows loaded, say), rather than looping forever.
   */
  private restoreScroll(attempt = 0): void {
    const element = this.tableScroll?.nativeElement;
    const target = this.pagedSource?.scrollTop ?? 0;
    if (!element || target <= 0) {
      return;
    }

    element.scrollTop = target;

    if (Math.abs(element.scrollTop - target) > 1 && attempt < DataGridComponent.SCROLL_RESTORE_FRAMES) {
      requestAnimationFrame(() => this.restoreScroll(attempt + 1));
    }
  }

  get resolvedEmptyMessage(): string {
    // "No contacts found." is a claim about the COLLECTION, and on a paged
    // table with a filter on it the grid has only looked at part of one. Say
    // what was actually searched instead - the note below the table carries
    // the button that searches the rest.
    if (this.filteringPartialSet) {
      return `No matches in the ${this.loadedCount} rows loaded so far.`;
    }
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
    // The grip leads the row, ahead of the checkbox - it is the handle for
    // the row itself, not for anything in it.
    if (this.reorderBy) {
      keys = ['reorder', ...keys];
    }
    return this.rowActions.length ? [...keys, 'actions'] : keys;
  }

  get filterColumnKeys(): string[] {
    let keys = this.visibleColumns.map((c) => `${c.key}-filter`);
    if (this.selection) {
      keys = ['select-filter', ...keys];
    }
    if (this.reorderBy) {
      keys = ['reorder-filter', ...keys];
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
      if (!date) {
        return String(value);
      }
      // Keyed on the parsed TIME, never on the raw value: a Firestore
      // Timestamp stringifies to "[object Object]", so a key built with
      // String(value) would collide across every timestamp in the table
      // and render one date in every cell. See A3 note below.
      return this.formatted(
        `d|${column.dateFormat ?? ''}|${date.getTime()}`,
        () => this.datePipe.transform(date, column.dateFormat) ?? ''
      );
    }
    if (column.type === 'currency') {
      const num = typeof value === 'number' ? value : Number(value);
      return isNaN(num) ? '' : this.formatted(
        `c|${num}`,
        () => this.currencyPipe.transform(num) ?? ''
      );
    }
    return String(value);
  }

  /**
   * Memoized pipe formatting (sweep finding A3).
   *
   * Nothing in this app opts out of default change detection, and CD runs
   * on essentially every scroll frame, so displayValue() is called for
   * every visible cell on every pass. Paged grids append pages, so the row
   * count is unbounded: four pages of Purchases is ~200 rows, which meant
   * ~1,200 uncached pipe .transform() calls per CD pass competing with the
   * 16.6ms frame budget exactly while the user is scrolling. Calling
   * .transform() directly bypasses the memoization that lives inside the
   * pipe, so there was none.
   *
   * THE KEY IS THE WHOLE CORRECTNESS ARGUMENT. It is derived from the
   * VALUE, never from the row. Rows in this grid are genuinely mutated in
   * place (the fulfillment screens write status onto the row object), so a
   * memo keyed on row identity would freeze that cell at its old text and
   * the bug would look like "the grid doesn't refresh".
   *
   * Cleared in recompute(), which runs whenever the row set, sort or
   * filters change - that bounds the map to the distinct values on screen.
   */
  private formatted(key: string, format: () => string): string {
    const hit = this.formatCache.get(key);
    if (hit !== undefined) {
      return hit;
    }
    const result = format();
    this.formatCache.set(key, result);
    return result;
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

  onRowClick(row: T): void {
    this.rowClick.emit(row);
  }

  // No-ops in static mode (there's nothing to page in) - safe to always
  // bind from the template regardless of which mode is active.
  loadMore(): void {
    this.pagedSource?.loadNextPage();
  }

  /**
   * Whether a filter is being applied to only PART of the collection.
   *
   * THE BUG THIS EXISTS FOR. Column filters match against the rows that are
   * loaded, and a paged grid starts with 50 of them. Filtering 5,450 contacts
   * for someone on page 30 therefore said "No contacts found" - an
   * authoritative-looking wrong answer, and the way a staff member concludes
   * a donor is not in the system and adds a duplicate. The grid now says what
   * it actually searched and offers to search the rest.
   */
  get filteringPartialSet(): boolean {
    return !!this.pagedSource && this.hasMore$.value && this.hasActiveFilter;
  }

  get hasActiveFilter(): boolean {
    return Object.values(this.filters).some((filter) => !!filter?.operator);
  }

  /** How many rows the filter actually looked at. Not a total - the grid has
   *  never counted the collection, and inventing a denominator would be its
   *  own kind of lie. */
  get loadedCount(): number {
    return this.sourceRows$.value.length;
  }

  /**
   * Pages in the rest of the collection and re-runs the filter over all of
   * it. Deliberately a button rather than something that happens on its own:
   * these are thousands of rows, and paging is why the screen opens quickly.
   */
  async searchAll(): Promise<void> {
    if (!this.pagedSource) {
      return;
    }
    this.searchedEverything = true;
    await this.pagedSource.loadAll();
  }

  /** Latches once the whole collection has been paged in, so the grid can
   *  say the search was complete instead of silently looking the same. */
  searchedEverything = false;

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

  // A3: distinct formatted values currently on screen. Cleared whenever the
  // rows, sort or filters change, which is what keeps it bounded.
  private formatCache = new Map<string, string>();

  private recompute(rows: T[]): void {
    this.formatCache.clear();

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
    // toMillis() and ContactDetailsComponent.toDate() already apply,
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
