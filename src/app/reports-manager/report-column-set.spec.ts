import { ReportColumnSet } from './report-column-set';

// Tests for the column/export machinery the three reports shared as three
// private copies (2026-08-27 sweep, P1) - `interface ColumnDef` declared
// three times, and displayedColumns / toggleColumn / columnLabel /
// gridColumns / fieldValue / exportExcel byte-identical across all of them.
//
// Written against the extraction, but every assertion describes what the
// copies already did, so they double as the characterization: the three
// reports must behave identically afterwards.
//
// The one real design change is that column TYPE now lives on the column
// definition. Each report previously carried a private toGridColumn() whose
// if-chain (`if (key === 'dateProcessed') ... if (key === 'total') ...`) was
// a hand-maintained parallel structure to the column list a few lines above
// it - the docs called these reports "reuses list-screen infra", which read
// as if a shared abstraction existed when it did not.

interface Row {
  name: string;
  total: number;
  when: Date;
  extra?: unknown;
}

function columns() {
  return new ReportColumnSet<Row>([
    { key: 'name', label: 'Name', visible: true },
    { key: 'total', label: 'Total', visible: true, type: 'currency' },
    { key: 'when', label: 'When', visible: true, type: 'date', dateFormat: 'short' },
    { key: 'extra', label: 'Extra', visible: false },
  ]);
}

describe('ReportColumnSet', () => {
  describe('visibility', () => {
    it('displayedColumns is the visible keys, in declared order', () => {
      expect(columns().displayedColumns).toEqual(['name', 'total', 'when']);
    });

    it('toggleColumn flips one column and nothing else', () => {
      const set = columns();
      set.toggleColumn(set.all[3]);
      expect(set.displayedColumns).toEqual(['name', 'total', 'when', 'extra']);

      set.toggleColumn(set.all[0]);
      expect(set.displayedColumns).toEqual(['total', 'when', 'extra']);
    });

    it('columnLabel falls back to the key for an unknown column', () => {
      // Matches the old behaviour exactly - a missing label must not render
      // "undefined" as a column header.
      expect(columns().columnLabel('name')).toBe('Name');
      expect(columns().columnLabel('nope')).toBe('nope');
    });
  });

  describe('gridColumns', () => {
    it('carries type and dateFormat from the definition', () => {
      // This is what replaced the per-report if-chains.
      const grid = columns().gridColumns;
      expect(grid[1]).toEqual(
        jasmine.objectContaining({ key: 'total', label: 'Total', type: 'currency' })
      );
      expect(grid[2]).toEqual(
        jasmine.objectContaining({ key: 'when', type: 'date', dateFormat: 'short' })
      );
    });

    it('omits type for a plain column, as the old default branch did', () => {
      const plain =
        columns().gridColumns[0] as unknown as Record<string, unknown>;
      expect(plain['key']).toBe('name');
      expect(plain['type']).toBeUndefined();
    });

    it('every grid column is sortable: false', () => {
      // All three reports set this; sorting is done by re-running the query.
      for (const column of columns().gridColumns) {
        expect(column.sortable).toBe(false);
      }
    });

    it('only visible columns reach the grid', () => {
      expect(columns().gridColumns.map((c) => c.key))
        .toEqual(['name', 'total', 'when']);
    });
  });

  describe('excel export', () => {
    const rows: Row[] = [
      { name: 'Ada', total: 12.5, when: new Date(2026, 0, 2), extra: { a: 1 } },
    ];

    it('exports only the visible columns, with their labels as headers', () => {
      const spec = columns().excelColumns();
      expect(spec.map((c) => c.header)).toEqual(['Name', 'Total', 'When']);
    });

    it('passes Date, string and number through untouched', () => {
      // The grid formats for display; the spreadsheet wants real values, so
      // a Date must stay a Date rather than becoming a formatted string.
      const spec = columns().excelColumns();
      expect(spec[0].value(rows[0])).toBe('Ada');
      expect(spec[1].value(rows[0])).toBe(12.5);
      expect(spec[2].value(rows[0])).toEqual(new Date(2026, 0, 2));
    });

    it('renders null and undefined as an empty cell, not "null"', () => {
      const spec = columns().excelColumns();
      const empty = { name: null, total: undefined } as unknown as Row;
      expect(spec[0].value(empty)).toBe('');
      expect(spec[1].value(empty)).toBe('');
    });

    it('String()s anything else - the documented sharp edge', () => {
      // Carried over deliberately: an object column silently exports
      // "[object Object]". It was a latent bug in all three copies; fixing
      // it is a behaviour change, so it is PINNED here rather than quietly
      // altered during an extraction.
      const set = columns();
      set.toggleColumn(set.all[3]);
      const spec = set.excelColumns();
      expect(spec[3].value(rows[0])).toBe('[object Object]');
    });
  });
});
