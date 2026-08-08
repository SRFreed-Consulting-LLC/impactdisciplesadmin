// Mirrors DevExtreme's filter-row operator set. Each column's filter cell
// gets an operator dropdown (Contains, Equals, Greater Than, Is Blank, etc.)
// plus a value input, instead of a plain "contains" text box.
export type FilterOperator =
  | 'contains' | 'notContains' | 'startsWith' | 'endsWith'
  | 'equals' | 'notEquals'
  | 'greaterThan' | 'greaterThanOrEqual' | 'lessThan' | 'lessThanOrEqual'
  | 'blank' | 'notBlank';

export interface FilterOperatorOption {
  value: FilterOperator;
  label: string;
  // A Material icon ligature name (rendered via <mat-icon>) - used for
  // operators with a reasonably intuitive icon (Contains, Starts With,
  // Is Blank, etc). Mutually exclusive with `glyph`.
  icon?: string;
  // A literal text symbol (=, <>, >, >=, <, <=) - used for the comparison
  // operators DevExtreme itself renders as math symbols rather than icons,
  // since Material's icon set has no "equals"/"greater than" glyphs.
  glyph?: string;
}

export interface ColumnFilterValue {
  operator: FilterOperator;
  value: string;
}

export const TEXT_FILTER_OPERATORS: FilterOperatorOption[] = [
  { value: 'contains', label: 'Contains', icon: 'search' },
  { value: 'notContains', label: 'Does Not Contain', icon: 'search_off' },
  { value: 'startsWith', label: 'Starts With', icon: 'first_page' },
  { value: 'endsWith', label: 'Ends With', icon: 'last_page' },
  { value: 'equals', label: 'Equals', glyph: '=' },
  { value: 'notEquals', label: 'Does Not Equal', glyph: '≠' },
  { value: 'blank', label: 'Is Blank', icon: 'block' },
  { value: 'notBlank', label: 'Is Not Blank', icon: 'check_circle' }
];

export const NUMBER_FILTER_OPERATORS: FilterOperatorOption[] = [
  { value: 'equals', label: 'Equals', glyph: '=' },
  { value: 'notEquals', label: 'Does Not Equal', glyph: '≠' },
  { value: 'greaterThan', label: 'Greater Than', glyph: '>' },
  { value: 'greaterThanOrEqual', label: 'Greater Than or Equal To', glyph: '≥' },
  { value: 'lessThan', label: 'Less Than', glyph: '<' },
  { value: 'lessThanOrEqual', label: 'Less Than or Equal To', glyph: '≤' },
  { value: 'blank', label: 'Is Blank', icon: 'block' },
  { value: 'notBlank', label: 'Is Not Blank', icon: 'check_circle' }
];

export const DATE_FILTER_OPERATORS: FilterOperatorOption[] = NUMBER_FILTER_OPERATORS;

function isBlank(rawValue: any): boolean {
  return rawValue === null || rawValue === undefined || rawValue === '';
}

export function matchesColumnFilter(
  rawValue: any,
  filter: ColumnFilterValue | undefined,
  type: 'text' | 'number' | 'date' = 'text'
): boolean {
  if (!filter || !filter.operator) {
    return true;
  }

  if (filter.operator === 'blank') {
    return isBlank(rawValue);
  }
  if (filter.operator === 'notBlank') {
    return !isBlank(rawValue);
  }
  if (isBlank(filter.value)) {
    return true;
  }

  if (type === 'number') {
    const num = Number(rawValue);
    const term = Number(filter.value);
    if (isNaN(num) || isNaN(term)) {
      return true;
    }
    switch (filter.operator) {
      case 'equals': return num === term;
      case 'notEquals': return num !== term;
      case 'greaterThan': return num > term;
      case 'greaterThanOrEqual': return num >= term;
      case 'lessThan': return num < term;
      case 'lessThanOrEqual': return num <= term;
      default: return true;
    }
  }

  if (type === 'date') {
    const d = rawValue instanceof Date ? rawValue.getTime() : new Date(rawValue).getTime();
    const term = new Date(filter.value).getTime();
    if (isNaN(d) || isNaN(term)) {
      return true;
    }
    switch (filter.operator) {
      case 'equals': return d === term;
      case 'notEquals': return d !== term;
      case 'greaterThan': return d > term;
      case 'greaterThanOrEqual': return d >= term;
      case 'lessThan': return d < term;
      case 'lessThanOrEqual': return d <= term;
      default: return true;
    }
  }

  const str = (rawValue ?? '').toString().toLowerCase();
  const term = filter.value.toLowerCase();
  switch (filter.operator) {
    case 'contains': return str.includes(term);
    case 'notContains': return !str.includes(term);
    case 'startsWith': return str.startsWith(term);
    case 'endsWith': return str.endsWith(term);
    case 'equals': return str === term;
    case 'notEquals': return str !== term;
    default: return true;
  }
}
