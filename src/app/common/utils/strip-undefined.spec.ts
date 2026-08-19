import { stripUndefinedDeep } from './strip-undefined';

describe('stripUndefinedDeep', () => {
  it('removes top-level undefined fields', () => {
    const input: Record<string, unknown> = { a: 1, b: undefined, c: 'x' };
    expect(stripUndefinedDeep(input)).toEqual({ a: 1, c: 'x' });
  });

  it('removes deeply nested undefined fields', () => {
    const input: Record<string, unknown> = {
      a: { b: { c: undefined, d: 2 } },
      e: [{ f: undefined, g: 3 }]
    };
    expect(stripUndefinedDeep(input)).toEqual({ a: { b: { d: 2 } }, e: [{ g: 3 }] });
  });

  it('preserves null (Firestore accepts null, rejects undefined)', () => {
    expect(stripUndefinedDeep({ a: null, b: { c: null } })).toEqual({ a: null, b: { c: null } });
  });

  it('maps arrays without dropping falsy entries', () => {
    expect(stripUndefinedDeep([0, '', false, null])).toEqual([0, '', false, null]);
  });

  it('passes class instances through untouched', () => {
    const date = new Date(0);
    const result = stripUndefinedDeep({ when: date });
    expect(result.when).toBe(date);
  });
});
