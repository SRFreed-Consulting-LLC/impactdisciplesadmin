import { DataGridColumn } from '../shared/data-grid/data-grid.model';
import { ExcelColumn, exportToExcel } from '../shared/table-export.util';

/**
 * One report column: what it is called, whether it is showing, and how the
 * grid should render it.
 *
 * `type`/`dateFormat` are the design change that removed the per-report
 * `toGridColumn()` if-chains. Each report used to carry one - `if (key ===
 * 'dateProcessed') return {type: 'date'} ...` - which was a hand-maintained
 * parallel structure to the column list a few lines above it, and the one
 * thing that made adding a column a two-place edit.
 */
export interface ReportColumn {
  key: string;
  label: string;
  visible: boolean;
  /** Passed straight through to the data grid. Omit for a plain text cell. */
  type?: DataGridColumn<unknown>['type'];
  /** Only meaningful with `type: 'date'`. */
  dateFormat?: string;
}

/**
 * The column-visibility, grid-column and Excel-export machinery every report
 * screen needs.
 *
 * Extracted 2026-08-27 (sweep P1) from three private copies in
 * contact-report, purchase-report and subscriber-report: `interface
 * ColumnDef` was declared three times, and displayedColumns / toggleColumn /
 * columnLabel / gridColumns / fieldValue / exportExcel were byte-identical
 * in all three. `docs/reports-manager.md` already described these screens as
 * "reuses list-screen infra", which read as though this abstraction existed
 * when it did not - so a fourth report meant copying ~90 lines of TypeScript
 * before writing a single query.
 *
 * Deliberately a plain class, not a service: it holds one screen's mutable
 * column state, so a report constructs its own and keeps it as a field.
 */
export class ReportColumnSet<TRow> {
  constructor(private readonly columns: ReportColumn[]) {}

  /** Every column, visible or not - what the Columns menu iterates. */
  get all(): ReportColumn[] {
    return this.columns;
  }

  /** The keys currently showing, in declared order. */
  get displayedColumns(): string[] {
    return this.columns.filter((c) => c.visible).map((c) => c.key);
  }

  /**
   * Shows or hides one column. Mutates in place - the Columns menu binds
   * straight to `all`.
   * @param {ReportColumn} column The column to flip.
   */
  toggleColumn(column: ReportColumn): void {
    column.visible = !column.visible;
  }

  /**
   * A column's header text, falling back to its key.
   *
   * The fallback is load-bearing: a column whose label went missing must
   * render its key, not "undefined", in both the grid and the spreadsheet.
   * @param {string} key The column key.
   * @return {string} The label, or the key.
   */
  columnLabel(key: string): string {
    return this.columns.find((c) => c.key === key)?.label ?? key;
  }

  /** The visible columns as data-grid columns. Sorting is deliberately off
   *  on every report - results are re-ordered by re-running the query. */
  get gridColumns(): DataGridColumn<TRow>[] {
    return this.columns
      .filter((c) => c.visible)
      .map((c) => ({
        key: c.key,
        label: c.label,
        sortable: false,
        ...(c.type ? { type: c.type } : {}),
        ...(c.dateFormat ? { dateFormat: c.dateFormat } : {}),
      })) as DataGridColumn<TRow>[];
  }

  /**
   * The visible columns as an Excel spec.
   *
   * Dates, strings and numbers pass through as themselves rather than as
   * formatted text - the grid formats for display, but a spreadsheet wants
   * real values so its own date and currency formatting can apply.
   *
   * KNOWN SHARP EDGE, carried over from all three copies rather than
   * silently changed: anything else is `String()`-ed, so an object-valued
   * column exports "[object Object]". Fixing that is a behaviour change and
   * belongs in its own commit; report-column-set.spec.ts pins it so the
   * current behaviour is at least deliberate.
   * @return {ExcelColumn<TRow>[]} One entry per visible column.
   */
  excelColumns(): ExcelColumn<TRow>[] {
    return this.displayedColumns.map((key) => ({
      header: this.columnLabel(key),
      value: (row: TRow): string | number | Date => {
        const value = (row as unknown as Record<string, unknown>)[key];
        if (
          value instanceof Date ||
          typeof value === 'string' ||
          typeof value === 'number'
        ) {
          return value;
        }
        return value == null ? '' : String(value);
      },
    }));
  }

  /**
   * Exports the given rows to a spreadsheet of the visible columns.
   * @param {TRow[]} rows The rows on screen.
   * @param {string} fileName The download filename.
   * @return {Promise<void>} Resolves when the download has been handed off.
   */
  exportExcel(rows: TRow[], fileName: string): Promise<void> {
    return exportToExcel(rows, this.excelColumns(), fileName);
  }
}
