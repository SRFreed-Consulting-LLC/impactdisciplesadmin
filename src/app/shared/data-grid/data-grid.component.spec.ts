import { CurrencyPipe, DatePipe } from '@angular/common';
import { SelectionModel } from '@angular/cdk/collections';
import { SimpleChange, SimpleChanges } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { DataGridComponent } from './data-grid.component';
import { DataGridColumn, DataGridRowAction } from './data-grid.model';

// TestBed as an INJECTOR only - the class is registered as a provider and
// Angular constructs it. No compileComponents(), no createComponent(), so no
// template renders and none of this component's module imports are needed.
//
// Deliberately NOT `new DataGridComponent(datePipe, currencyPipe)`, even
// though that works today: this resolves constructor parameters and
// `inject()` field initializers alike, so the spec keeps working unchanged
// when this file converts to `inject()` (the direction all three apps are
// moving). The `new` form would have to be rewritten on that day.
//
// This grid backs roughly thirty admin screens, so its filter/sort/format
// rules are the ones most likely to break something far away from the change
// that caused it.

interface Row {
  id: string;
  name: string;
  amount: number;
  when: Date;
  archived?: boolean;
}

/** ContentChildren is never populated outside a real template, and
 *  ngAfterContentInit reads it - stand in a QueryList-shaped object so the
 *  lifecycle hook (which is what wires recompute to the row stream) can run. */
function withFakeContentChildren(grid: DataGridComponent<Row>): void {
  (grid as unknown as { cellTemplateDirectives: unknown }).cellTemplateDirectives = {
    changes: new Subject(),
    forEach: () => undefined,
  };
}

/** A fresh injector, and therefore a fresh component, per call - several
 *  tests below need two independent grids. */
function newGrid(): DataGridComponent<Row> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [DataGridComponent, DatePipe, CurrencyPipe],
  });
  return TestBed.inject(DataGridComponent) as DataGridComponent<Row>;
}

function makeGrid(columns: DataGridColumn<Row>[], rows: Row[] = []): DataGridComponent<Row> {
  const grid = newGrid();
  grid.columns = columns;
  grid.rows = rows;
  withFakeContentChildren(grid);
  grid.ngOnInit();
  grid.ngAfterContentInit();
  pushRows(grid, rows);
  return grid;
}

/** The @Input path: ngOnChanges is what feeds rows into the row stream. */
function pushRows(grid: DataGridComponent<Row>, rows: Row[]): void {
  grid.rows = rows;
  grid.ngOnChanges({ rows: new SimpleChange(null, rows, false) } as unknown as SimpleChanges);
}

const COLUMNS: DataGridColumn<Row>[] = [
  { key: 'name', label: 'Name' },
  { key: 'amount', label: 'Amount', type: 'currency' },
  { key: 'when', label: 'When', type: 'date' },
];

const ROWS: Row[] = [
  { id: '1', name: 'Beta', amount: 20, when: new Date('2026-02-01T00:00:00Z') },
  { id: '2', name: 'alpha', amount: 5, when: new Date('2026-01-01T00:00:00Z') },
  { id: '3', name: 'Gamma', amount: 15, when: new Date('2026-03-01T00:00:00Z'), archived: true },
];

describe('DataGridComponent', () => {
  describe('columns', () => {
    it('hides columns marked not visible', () => {
      const grid = makeGrid([...COLUMNS, { key: 'secret', label: 'Secret', visible: false }]);
      expect(grid.visibleColumns.map((c) => c.key)).toEqual(['name', 'amount', 'when']);
    });

    it('adds a select column only when a selection model is bound', () => {
      const plain = makeGrid(COLUMNS);
      expect(plain.displayedColumnKeys).toEqual(['name', 'amount', 'when']);

      const selectable = makeGrid(COLUMNS);
      selectable.selection = new SelectionModel<Row>(true, []);
      expect(selectable.displayedColumnKeys[0]).toBe('select');
    });

    it('adds an actions column only when there are row actions', () => {
      const grid = makeGrid(COLUMNS);
      grid.rowActions = [{ icon: 'delete', tooltip: 'DELETE', onClick: () => undefined }];
      expect(grid.displayedColumnKeys[grid.displayedColumnKeys.length - 1]).toBe('actions');
    });

    it('keeps the filter row keys aligned with the displayed columns', () => {
      const grid = makeGrid(COLUMNS);
      grid.selection = new SelectionModel<Row>(true, []);
      grid.rowActions = [{ icon: 'delete', tooltip: 'DELETE', onClick: () => undefined }];
      expect(grid.filterColumnKeys.length).toBe(grid.displayedColumnKeys.length);
      expect(grid.filterColumnKeys[0]).toBe('select-filter');
      expect(grid.filterColumnKeys).toContain('name-filter');
    });

    it('toggleColumn flips visibility both ways', () => {
      const grid = makeGrid(COLUMNS);
      const column = grid.columns[0];
      grid.toggleColumn(column);
      expect(column.visible).toBeFalse();
      grid.toggleColumn(column);
      expect(column.visible).toBeTrue();
    });
  });

  describe('empty message', () => {
    it('uses an explicit message when given one', () => {
      const grid = makeGrid(COLUMNS);
      grid.emptyMessage = 'Nothing here yet.';
      expect(grid.resolvedEmptyMessage).toBe('Nothing here yet.');
    });

    it('names the list when there is a title', () => {
      const grid = makeGrid(COLUMNS);
      grid.title = 'Campaigns';
      expect(grid.resolvedEmptyMessage).toBe('No Campaigns found.');
    });

    it('falls back to a generic message with no title', () => {
      expect(makeGrid(COLUMNS).resolvedEmptyMessage).toBe('No records found.');
    });
  });

  describe('value resolution and display', () => {
    it('reads the key off the row when no value fn is given', () => {
      const grid = makeGrid(COLUMNS, ROWS);
      expect(grid.resolveValue(COLUMNS[0], ROWS[0])).toBe('Beta');
    });

    it('prefers an explicit value fn', () => {
      const grid = makeGrid(COLUMNS, ROWS);
      const column: DataGridColumn<Row> = { key: 'name', label: 'Name', value: (r) => r.name.toUpperCase() };
      expect(grid.resolveValue(column, ROWS[0])).toBe('BETA');
    });

    it('renders blank rather than throwing for null and empty values', () => {
      // The whole reason formatting happens in TS instead of a | date pipe:
      // DatePipe.transform() throws on an unparseable value, which would
      // take out the entire table rather than one cell.
      const grid = makeGrid(COLUMNS, ROWS);
      const dateColumn: DataGridColumn<Row> = { key: 'when', label: 'When', type: 'date', value: () => null };
      expect(grid.displayValue(dateColumn, ROWS[0])).toBe('');

      const blank: DataGridColumn<Row> = { key: 'when', label: 'When', type: 'date', value: () => '' };
      expect(grid.displayValue(blank, ROWS[0])).toBe('');
    });

    it('falls back to the raw string for a date it cannot parse', () => {
      const grid = makeGrid(COLUMNS, ROWS);
      const column: DataGridColumn<Row> = { key: 'when', label: 'When', type: 'date', value: () => 'not a date' };
      expect(grid.displayValue(column, ROWS[0])).toBe('not a date');
    });

    it('formats a real date', () => {
      const grid = makeGrid(COLUMNS, ROWS);
      expect(grid.displayValue(COLUMNS[2], ROWS[0])).toBeTruthy();
    });

    it('formats currency, and blanks a non-numeric one instead of printing NaN', () => {
      const grid = makeGrid(COLUMNS, ROWS);
      expect(grid.displayValue(COLUMNS[1], ROWS[0])).toContain('20');

      const broken: DataGridColumn<Row> = { key: 'amount', label: 'Amount', type: 'currency', value: () => 'abc' };
      expect(grid.displayValue(broken, ROWS[0])).toBe('');
    });

    it('stringifies anything else', () => {
      const grid = makeGrid(COLUMNS, ROWS);
      const column: DataGridColumn<Row> = { key: 'name', label: 'Name', value: () => 42 };
      expect(grid.displayValue(column, ROWS[0])).toBe('42');
    });
  });

  describe('filter typing', () => {
    it('treats currency as a number filter, since only display differs', () => {
      const grid = makeGrid(COLUMNS);
      expect(grid.filterTypeFor({ key: 'amount', label: '', type: 'currency' })).toBe('number');
      expect(grid.operatorsFor({ key: 'amount', label: '', type: 'currency' }))
        .toBe(grid.operatorsFor({ key: 'amount', label: '', type: 'number' }));
    });

    it('defaults an untyped column to text', () => {
      const grid = makeGrid(COLUMNS);
      expect(grid.filterTypeFor({ key: 'name', label: '' })).toBe('text');
    });

    it('gives date columns their own operator set', () => {
      const grid = makeGrid(COLUMNS);
      expect(grid.operatorsFor({ key: 'when', label: '', type: 'date' }))
        .not.toBe(grid.operatorsFor({ key: 'name', label: '' }));
    });
  });

  describe('sorting', () => {
    it('cycles a header through asc, desc, then unsorted', () => {
      const grid = makeGrid(COLUMNS, ROWS);
      grid.onHeaderClick(COLUMNS[0]);
      expect([grid.sortKey, grid.sortDirection]).toEqual(['name', 'asc']);
      grid.onHeaderClick(COLUMNS[0]);
      expect([grid.sortKey, grid.sortDirection]).toEqual(['name', 'desc']);
      grid.onHeaderClick(COLUMNS[0]);
      expect([grid.sortKey, grid.sortDirection]).toEqual([null, null]);
    });

    it('restarts at asc when a different column is clicked', () => {
      const grid = makeGrid(COLUMNS, ROWS);
      grid.onHeaderClick(COLUMNS[0]);
      grid.onHeaderClick(COLUMNS[0]);
      grid.onHeaderClick(COLUMNS[1]);
      expect([grid.sortKey, grid.sortDirection]).toEqual(['amount', 'asc']);
    });

    it('ignores clicks on a column marked unsortable', () => {
      const grid = makeGrid([{ key: 'name', label: 'Name', sortable: false }], ROWS);
      grid.onHeaderClick(grid.columns[0]);
      expect(grid.sortKey).toBeNull();
    });

    it('sorts text case-insensitively, so "alpha" leads "Beta"', () => {
      const grid = makeGrid(COLUMNS, ROWS);
      grid.onHeaderClick(COLUMNS[0]);
      expect(grid.visibleRows.map((r) => r.name)).toEqual(['alpha', 'Beta', 'Gamma']);
    });

    it('sorts numbers numerically rather than lexically', () => {
      const grid = makeGrid(COLUMNS, ROWS);
      grid.onHeaderClick(COLUMNS[1]);
      expect(grid.visibleRows.map((r) => r.amount)).toEqual([5, 15, 20]);
    });

    it('sorts dates chronologically', () => {
      const grid = makeGrid(COLUMNS, ROWS);
      grid.onHeaderClick(COLUMNS[2]);
      expect(grid.visibleRows.map((r) => r.id)).toEqual(['2', '1', '3']);
    });

    it('reverses on the descending pass', () => {
      const grid = makeGrid(COLUMNS, ROWS);
      grid.onHeaderClick(COLUMNS[1]);
      grid.onHeaderClick(COLUMNS[1]);
      expect(grid.visibleRows.map((r) => r.amount)).toEqual([20, 15, 5]);
    });

    it('honours a column\'s own sortFn over the default compare', () => {
      const columns: DataGridColumn<Row>[] = [
        { key: 'name', label: 'Name', sortFn: (a, b) => a.id.localeCompare(b.id) },
      ];
      const grid = makeGrid(columns, ROWS);
      grid.onHeaderClick(columns[0]);
      expect(grid.visibleRows.map((r) => r.id)).toEqual(['1', '2', '3']);
    });

    it('applies an initial sort declared by the caller', () => {
      const grid = newGrid();
      grid.columns = COLUMNS;
      grid.initialSortKey = 'amount';
      grid.initialSortDirection = 'desc';
      withFakeContentChildren(grid);
      grid.ngOnInit();
      grid.ngAfterContentInit();
      pushRows(grid, ROWS);
      expect(grid.visibleRows.map((r) => r.amount)).toEqual([20, 15, 5]);
    });
  });

  describe('rows', () => {
    it('shows everything when nothing is filtered', () => {
      expect(makeGrid(COLUMNS, ROWS).visibleRows.length).toBe(3);
    });

    it('recomputes visible rows when the source changes', () => {
      const grid = makeGrid(COLUMNS, ROWS);
      pushRows(grid, [ROWS[0]]);
      expect(grid.visibleRows.length).toBe(1);
    });

    it('treats a null rows input as empty rather than throwing', () => {
      const grid = makeGrid(COLUMNS, ROWS);
      pushRows(grid, null as unknown as Row[]);
      expect(grid.visibleRows).toEqual([]);
    });
  });

  describe('row actions', () => {
    it('hides an action whose visible() says no for that row', () => {
      const grid = makeGrid(COLUMNS, ROWS);
      const actions: DataGridRowAction<Row>[] = [
        { icon: 'delete', tooltip: 'DELETE', onClick: () => undefined, visible: (row) => !row.archived },
        { icon: 'edit', tooltip: 'EDIT', onClick: () => undefined },
      ];
      grid.rowActions = actions;
      expect(grid.visibleActionsFor(ROWS[0]).length).toBe(2);
      expect(grid.visibleActionsFor(ROWS[2]).map((a) => a.icon)).toEqual(['edit']);
    });
  });

  describe('selection', () => {
    it('does nothing when no selection model is bound', () => {
      const grid = makeGrid(COLUMNS, ROWS);
      expect(() => grid.masterToggle()).not.toThrow();
      expect(() => grid.toggleRow(ROWS[0])).not.toThrow();
      expect(grid.isAllSelected()).toBeFalse();
    });

    it('selects and clears every visible row', () => {
      const grid = makeGrid(COLUMNS, ROWS);
      grid.selection = new SelectionModel<Row>(true, []);
      grid.masterToggle();
      expect(grid.isAllSelected()).toBeTrue();
      grid.masterToggle();
      expect(grid.selection.selected.length).toBe(0);
    });

    it('reports not-all-selected for an empty grid', () => {
      const grid = makeGrid(COLUMNS, []);
      grid.selection = new SelectionModel<Row>(true, []);
      expect(grid.isAllSelected()).toBeFalse();
    });

    it('toggles one row and announces the new selection', () => {
      const grid = makeGrid(COLUMNS, ROWS);
      grid.selection = new SelectionModel<Row>(true, []);
      const emitted: Row[][] = [];
      grid.selectionChange.subscribe((rows) => emitted.push(rows));
      grid.toggleRow(ROWS[0]);
      expect(emitted[0].length).toBe(1);
      grid.toggleRow(ROWS[0]);
      expect(emitted[1].length).toBe(0);
    });
  });

  describe('row events', () => {
    it('emits click and double click separately', () => {
      const grid = makeGrid(COLUMNS, ROWS);
      const clicks: Row[] = [];
      const doubles: Row[] = [];
      grid.rowClick.subscribe((r) => clicks.push(r));
      grid.rowDoubleClick.subscribe((r) => doubles.push(r));
      grid.onRowClick(ROWS[0]);
      grid.onRowDoubleClick(ROWS[1]);
      expect(clicks).toEqual([ROWS[0]]);
      expect(doubles).toEqual([ROWS[1]]);
    });
  });

  describe('paging', () => {
    it('loadMore is a no-op in static mode', () => {
      // Always bound from the template, so it must be safe with no source.
      expect(() => makeGrid(COLUMNS, ROWS).loadMore()).not.toThrow();
    });

    it('delegates to the paged source when there is one', () => {
      const grid = makeGrid(COLUMNS, ROWS);
      let called = 0;
      grid.pagedSource = { loadNextPage: () => { called++; } } as never;
      grid.loadMore();
      expect(called).toBe(1);
    });
  });

  // Sweep finding A3. The measurement the report asked for, expressed as a
  // COUNT of pipe calls rather than a wall clock: deterministic, runs in
  // CI, and it is the quantity that actually mattered (uncached
  // .transform() competing with the frame budget during scroll).
  describe('formatting is memoized', () => {
    /** Counts real pipe invocations while keeping real formatting. */
    function countingGrid(rows: Row[]) {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [DataGridComponent, DatePipe, CurrencyPipe],
      });
      const grid = TestBed.inject(DataGridComponent) as DataGridComponent<Row>;
      const datePipe = TestBed.inject(DatePipe);
      const currencyPipe = TestBed.inject(CurrencyPipe);
      const calls = { date: 0, currency: 0 };
      const realDate = datePipe.transform.bind(datePipe);
      const realCurrency = currencyPipe.transform.bind(currencyPipe);
      spyOn(datePipe, 'transform').and.callFake(((v: never, f: never) => {
        calls.date++;
        return realDate(v, f);
      }) as never);
      spyOn(currencyPipe, 'transform').and.callFake(((v: never) => {
        calls.currency++;
        return realCurrency(v);
      }) as never);

      grid.columns = COLUMNS;
      grid.rows = rows;
      withFakeContentChildren(grid);
      grid.ngOnInit();
      grid.ngAfterContentInit();
      pushRows(grid, rows);
      return { grid, calls };
    }

    /** One change-detection pass over every visible cell. */
    function renderPass(grid: DataGridComponent<Row>, rows: Row[]): void {
      for (const row of rows) {
        for (const column of COLUMNS) {
          grid.displayValue(column, row);
        }
      }
    }

    it('formats each distinct value once, however many passes run', () => {
      const rows = ROWS;
      const { grid, calls } = countingGrid(rows);

      renderPass(grid, rows);
      const afterFirst = { ...calls };

      // Nine more passes - what scrolling actually costs.
      for (let i = 0; i < 9; i++) {
        renderPass(grid, rows);
      }

      // BEFORE this fix these numbers were afterFirst x 10.
      expect(calls.date).toBe(afterFirst.date);
      expect(calls.currency).toBe(afterFirst.currency);
    });

    it('formats a repeated value once across rows, not once per row', () => {
      const when = new Date('2026-02-01T00:00:00Z');
      const rows: Row[] = Array.from({ length: 50 }, (_, i) => ({
        id: String(i), name: `Row ${i}`, amount: 20, when
      }));
      const { grid, calls } = countingGrid(rows);

      renderPass(grid, rows);

      // 50 rows, one distinct amount and one distinct date between them.
      expect(calls.currency).toBe(1);
      expect(calls.date).toBe(1);
    });

    // THE CORRECTNESS CONSTRAINT. Rows in this grid are mutated in place -
    // the fulfillment screens write onto the row object - so a memo keyed
    // on row identity would freeze the cell at its old text and look like
    // "the grid stopped refreshing". The key is derived from the VALUE.
    it('reflects a row mutated in place', () => {
      const rows: Row[] = [
        { id: '1', name: 'A', amount: 20, when: new Date('2026-02-01T00:00:00Z') }
      ];
      const { grid } = countingGrid(rows);

      expect(grid.displayValue(COLUMNS[1], rows[0])).toContain('20');
      rows[0].amount = 999;
      expect(grid.displayValue(COLUMNS[1], rows[0])).toContain('999');
    });

    // A Firestore Timestamp stringifies to "[object Object]", so a cache
    // key built from the RAW value would collide across every timestamp
    // and render one date in every cell.
    it('does not collide across values that stringify identically', () => {
      const rows: Row[] = [
        { id: '1', name: 'A', amount: 1, when: new Date('2026-02-01T00:00:00Z') },
        { id: '2', name: 'B', amount: 2, when: new Date('2027-09-15T00:00:00Z') }
      ];
      const { grid } = countingGrid(rows);

      const first = grid.displayValue(COLUMNS[2], rows[0]);
      const second = grid.displayValue(COLUMNS[2], rows[1]);
      expect(first).not.toBe(second);
      expect(first).toBeTruthy();
      expect(second).toBeTruthy();
    });

    it('is cleared when the row set changes, so it cannot grow unbounded', () => {
      const rows = ROWS;
      const { grid, calls } = countingGrid(rows);
      renderPass(grid, rows);
      const afterFirst = calls.currency;

      pushRows(grid, rows);
      renderPass(grid, rows);

      expect(calls.currency).toBeGreaterThan(afterFirst);
    });
  });

  describe('teardown', () => {
    it('stops processing source updates after destroy', () => {
      // Was asserted through the visibleRowsChange output, removed 2026-08-28
      // as dead API (no binding across 176 templates). The BEHAVIOUR it
      // covered is real - a destroyed grid must not keep recomputing off a
      // still-live source - so it is asserted directly instead.
      const grid = makeGrid(COLUMNS, ROWS);
      const before = grid.visibleRows.length;
      grid.ngOnDestroy();
      pushRows(grid, [ROWS[0]]);
      expect(grid.visibleRows.length).toBe(before);
    });
  });
});
