// Column definition for <app-data-grid>. `type` drives both the filter
// row's operator set (see column-filter.model.ts's TEXT_/NUMBER_/
// DATE_FILTER_OPERATORS) and the default (non-templated) cell's display
// formatting - the two nearly always coincide (a date column filters as a
// date and displays as a date), so keeping one field for both avoids a
// redundant second property on every column.
export interface DataGridColumn<T> {
  key: string;
  label: string;
  /** Defaults to true. Mutated in place by the grid's own Columns menu -
   *  same array reference the caller passed in, so the caller sees the
   *  toggle too if it ever needs to. */
  visible?: boolean;
  /** Defaults to 'text'. 'currency' filters as a number but displays via
   *  Angular's CurrencyPipe (matching every `| currency` cell across the
   *  app's tables - costs, totals, taxes, etc). */
  type?: 'text' | 'number' | 'date' | 'currency';
  /** Angular DatePipe format string (e.g. 'short', 'HH:mm') for a 'date'
   *  column whose original cell used something other than the default
   *  `| date` format. Ignored for other types. */
  dateFormat?: string;
  /** Defaults to true. Set false for columns where a filter doesn't make
   *  sense (e.g. a computed status badge) - matches the existing convention
   *  of leaving that column's filter-row cell empty. */
  filterable?: boolean;
  /** Defaults to true. */
  sortable?: boolean;
  /** Resolves this column's underlying value for a row - used for the
   *  default (non-templated) cell display, filtering, sorting, and export.
   *  Defaults to `row[key]`. Provide this whenever `key` isn't a direct
   *  property (a computed/looked-up value) or the property needs coercion. */
  value?: (row: T) => unknown;
  /** Overrides `value()` just for the exported spreadsheet cell - for
   *  columns whose on-screen value (via a cell template) isn't what should
   *  land in the export (e.g. exporting a raw phone number where the
   *  screen shows a formatted one). Falls back to `value()` when omitted. */
  exportValue?: (row: T) => string | number | Date | null | undefined;
  /** Overrides the default value-comparison sort for this column - needed
   *  for columns whose displayed/filtered value isn't what should drive
   *  sort order (e.g. sorting an "isActive" badge column by the boolean
   *  itself rather than its "LIVE"/"INACTIVE" label). */
  sortFn?: (a: T, b: T) => number;
  /** Extra CSS class on this column's <td> (e.g. a long-text column that
   *  truncates with an ellipsis). */
  cellClass?: string;
}

export interface DataGridRowAction<T> {
  icon: string;
  tooltip: string;
  onClick: (row: T) => void;
  /** Defaults to always visible. */
  visible?: (row: T) => boolean;
}
