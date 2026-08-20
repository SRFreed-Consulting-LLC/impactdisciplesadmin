import {
  ColumnFilterValue,
  DATE_FILTER_OPERATORS,
  FilterOperator,
  matchesColumnFilter,
  NUMBER_FILTER_OPERATORS,
  TEXT_FILTER_OPERATORS
} from './column-filter.model';

function filter(operator: FilterOperator, value = ''): ColumnFilterValue {
  return { operator, value };
}

describe('matchesColumnFilter', () => {
  describe('no filter / empty filter', () => {
    it('passes everything when the filter is undefined', () => {
      expect(matchesColumnFilter('anything', undefined)).toBeTrue();
      expect(matchesColumnFilter(null, undefined, 'number')).toBeTrue();
    });

    it('passes everything when the filter has no operator', () => {
      expect(matchesColumnFilter('x', { operator: '' as FilterOperator, value: 'x' })).toBeTrue();
    });

    it('passes everything when the filter value is blank (except blank/notBlank)', () => {
      expect(matchesColumnFilter('abc', filter('contains', ''))).toBeTrue();
      expect(matchesColumnFilter(5, filter('greaterThan', ''), 'number')).toBeTrue();
      expect(matchesColumnFilter(new Date(), filter('lessThan', ''), 'date')).toBeTrue();
    });
  });

  describe('blank / notBlank (any type)', () => {
    it('blank matches null, undefined, and empty string', () => {
      expect(matchesColumnFilter(null, filter('blank'))).toBeTrue();
      expect(matchesColumnFilter(undefined, filter('blank'))).toBeTrue();
      expect(matchesColumnFilter('', filter('blank'))).toBeTrue();
    });

    it('blank does not match a real value, including 0 and false', () => {
      expect(matchesColumnFilter('x', filter('blank'))).toBeFalse();
      expect(matchesColumnFilter(0, filter('blank'), 'number')).toBeFalse();
      expect(matchesColumnFilter(false, filter('blank'))).toBeFalse();
    });

    it('notBlank is the exact inverse', () => {
      expect(matchesColumnFilter(null, filter('notBlank'))).toBeFalse();
      expect(matchesColumnFilter('', filter('notBlank'))).toBeFalse();
      expect(matchesColumnFilter('x', filter('notBlank'))).toBeTrue();
      expect(matchesColumnFilter(0, filter('notBlank'), 'number')).toBeTrue();
    });

    it('blank/notBlank ignore whatever is in the filter value box', () => {
      expect(matchesColumnFilter(null, { operator: 'blank', value: 'ignored' })).toBeTrue();
      expect(matchesColumnFilter('x', { operator: 'notBlank', value: 'ignored' })).toBeTrue();
    });
  });

  describe('text operators', () => {
    it('contains is case-insensitive substring match', () => {
      expect(matchesColumnFilter('Hello World', filter('contains', 'WORLD'))).toBeTrue();
      expect(matchesColumnFilter('Hello World', filter('contains', 'mars'))).toBeFalse();
    });

    it('notContains inverts contains', () => {
      expect(matchesColumnFilter('Hello World', filter('notContains', 'world'))).toBeFalse();
      expect(matchesColumnFilter('Hello World', filter('notContains', 'mars'))).toBeTrue();
    });

    it('startsWith / endsWith are case-insensitive', () => {
      expect(matchesColumnFilter('Hello World', filter('startsWith', 'hello'))).toBeTrue();
      expect(matchesColumnFilter('Hello World', filter('startsWith', 'World'))).toBeFalse();
      expect(matchesColumnFilter('Hello World', filter('endsWith', 'WORLD'))).toBeTrue();
      expect(matchesColumnFilter('Hello World', filter('endsWith', 'Hello'))).toBeFalse();
    });

    it('equals / notEquals compare whole strings case-insensitively', () => {
      expect(matchesColumnFilter('Hello', filter('equals', 'hello'))).toBeTrue();
      expect(matchesColumnFilter('Hello!', filter('equals', 'hello'))).toBeFalse();
      expect(matchesColumnFilter('Hello', filter('notEquals', 'hello'))).toBeFalse();
      expect(matchesColumnFilter('Hello', filter('notEquals', 'other'))).toBeTrue();
    });

    it('coerces non-string raw values before matching', () => {
      expect(matchesColumnFilter(1234, filter('contains', '23'))).toBeTrue();
      expect(matchesColumnFilter(true, filter('equals', 'true'))).toBeTrue();
    });

    it('treats null/undefined raw values as the empty string', () => {
      // '' contains '' is true, but any real term never matches
      expect(matchesColumnFilter(null, filter('contains', 'x'))).toBeFalse();
      expect(matchesColumnFilter(undefined, filter('startsWith', 'x'))).toBeFalse();
      expect(matchesColumnFilter(null, filter('notContains', 'x'))).toBeTrue();
      expect(matchesColumnFilter(undefined, filter('notEquals', 'x'))).toBeTrue();
    });

    it('number-only operators fall through to "pass" for text columns', () => {
      expect(matchesColumnFilter('abc', filter('greaterThan', 'a'))).toBeTrue();
      expect(matchesColumnFilter('abc', filter('lessThanOrEqual', 'z'))).toBeTrue();
    });
  });

  describe('number operators', () => {
    it('equals / notEquals', () => {
      expect(matchesColumnFilter(5, filter('equals', '5'), 'number')).toBeTrue();
      expect(matchesColumnFilter(5, filter('equals', '6'), 'number')).toBeFalse();
      expect(matchesColumnFilter(5, filter('notEquals', '6'), 'number')).toBeTrue();
      expect(matchesColumnFilter(5, filter('notEquals', '5'), 'number')).toBeFalse();
    });

    it('greaterThan / greaterThanOrEqual', () => {
      expect(matchesColumnFilter(10, filter('greaterThan', '5'), 'number')).toBeTrue();
      expect(matchesColumnFilter(5, filter('greaterThan', '5'), 'number')).toBeFalse();
      expect(matchesColumnFilter(5, filter('greaterThanOrEqual', '5'), 'number')).toBeTrue();
      expect(matchesColumnFilter(4, filter('greaterThanOrEqual', '5'), 'number')).toBeFalse();
    });

    it('lessThan / lessThanOrEqual', () => {
      expect(matchesColumnFilter(3, filter('lessThan', '5'), 'number')).toBeTrue();
      expect(matchesColumnFilter(5, filter('lessThan', '5'), 'number')).toBeFalse();
      expect(matchesColumnFilter(5, filter('lessThanOrEqual', '5'), 'number')).toBeTrue();
      expect(matchesColumnFilter(6, filter('lessThanOrEqual', '5'), 'number')).toBeFalse();
    });

    it('coerces numeric strings on the raw-value side', () => {
      expect(matchesColumnFilter('42', filter('equals', '42'), 'number')).toBeTrue();
      expect(matchesColumnFilter('42', filter('greaterThan', '40'), 'number')).toBeTrue();
    });

    it('passes the row through when either side is not a number', () => {
      expect(matchesColumnFilter('not-a-number', filter('equals', '5'), 'number')).toBeTrue();
      expect(matchesColumnFilter(5, filter('equals', 'abc'), 'number')).toBeTrue();
    });

    it('text-only operators fall through to "pass" for number columns', () => {
      expect(matchesColumnFilter(5, filter('contains', '5'), 'number')).toBeTrue();
      expect(matchesColumnFilter(5, filter('startsWith', '9'), 'number')).toBeTrue();
    });
  });

  describe('date operators', () => {
    const jan15 = '2024-01-15T00:00:00.000Z';
    const jan20 = '2024-01-20T00:00:00.000Z';

    it('equals / notEquals compare exact instants', () => {
      expect(matchesColumnFilter(new Date(jan15), filter('equals', jan15), 'date')).toBeTrue();
      expect(matchesColumnFilter(new Date(jan15), filter('equals', jan20), 'date')).toBeFalse();
      expect(matchesColumnFilter(new Date(jan15), filter('notEquals', jan20), 'date')).toBeTrue();
      expect(matchesColumnFilter(new Date(jan15), filter('notEquals', jan15), 'date')).toBeFalse();
    });

    it('greaterThan / lessThan compare chronologically', () => {
      expect(matchesColumnFilter(new Date(jan20), filter('greaterThan', jan15), 'date')).toBeTrue();
      expect(matchesColumnFilter(new Date(jan15), filter('greaterThan', jan20), 'date')).toBeFalse();
      expect(matchesColumnFilter(new Date(jan15), filter('lessThan', jan20), 'date')).toBeTrue();
      expect(matchesColumnFilter(new Date(jan20), filter('lessThan', jan15), 'date')).toBeFalse();
    });

    it('greaterThanOrEqual / lessThanOrEqual include the boundary', () => {
      expect(matchesColumnFilter(new Date(jan15), filter('greaterThanOrEqual', jan15), 'date')).toBeTrue();
      expect(matchesColumnFilter(new Date(jan15), filter('lessThanOrEqual', jan15), 'date')).toBeTrue();
    });

    it('accepts a date-parseable string or a millis number as the raw value', () => {
      expect(matchesColumnFilter(jan15, filter('equals', jan15), 'date')).toBeTrue();
      expect(matchesColumnFilter(new Date(jan15).getTime(), filter('equals', jan15), 'date')).toBeTrue();
    });

    it('passes the row through when either side is unparseable', () => {
      expect(matchesColumnFilter('garbage', filter('equals', jan15), 'date')).toBeTrue();
      expect(matchesColumnFilter(new Date(jan15), filter('equals', 'garbage'), 'date')).toBeTrue();
    });
  });
});

describe('operator tables', () => {
  it('text operators cover the string set plus blank/notBlank, no comparisons', () => {
    const values = TEXT_FILTER_OPERATORS.map((o) => o.value);
    expect(values).toEqual([
      'contains', 'notContains', 'startsWith', 'endsWith',
      'equals', 'notEquals', 'blank', 'notBlank'
    ]);
  });

  it('number operators cover the comparison set plus blank/notBlank, no substring ops', () => {
    const values = NUMBER_FILTER_OPERATORS.map((o) => o.value);
    expect(values).toEqual([
      'equals', 'notEquals', 'greaterThan', 'greaterThanOrEqual',
      'lessThan', 'lessThanOrEqual', 'blank', 'notBlank'
    ]);
  });

  it('date operators reuse the number table', () => {
    expect(DATE_FILTER_OPERATORS).toBe(NUMBER_FILTER_OPERATORS);
  });

  it('every operator option has exactly one of icon or glyph', () => {
    for (const option of [...TEXT_FILTER_OPERATORS, ...NUMBER_FILTER_OPERATORS]) {
      const hasIcon = !!option.icon;
      const hasGlyph = !!option.glyph;
      expect(hasIcon !== hasGlyph)
        .withContext(`${option.value} should have exactly one of icon/glyph`)
        .toBeTrue();
    }
  });
});
