import { stateVariants } from './state-variants';

// The reports' state pickers offer full names; `customers` overwhelmingly
// stores 2-letter codes (GA 1918 vs Georgia 266 in prod). Every case here is
// a filter result that used to come back silently short.
describe('stateVariants', () => {
  it('returns both spellings for a full name', () => {
    expect(stateVariants('Georgia').sort()).toEqual(['GA', 'Georgia']);
  });

  it('returns both spellings for a 2-letter code', () => {
    expect(stateVariants('GA').sort()).toEqual(['GA', 'Georgia']);
  });

  it('puts the caller\'s own value first, so the common case queries first', () => {
    expect(stateVariants('Georgia')[0]).toBe('Georgia');
    expect(stateVariants('GA')[0]).toBe('GA');
  });

  it('matches case-insensitively without changing what it returns', () => {
    // A picker always supplies canonical casing, but a saved filter or a
    // hand-built URL may not - and "georgia" matching nothing would be the
    // same silent-undercount bug in a different disguise.
    expect(stateVariants('georgia')).toContain('GA');
    expect(stateVariants('ga')).toContain('Georgia');
  });

  it('does not duplicate when the value already equals a spelling', () => {
    expect(stateVariants('GA').length).toBe(2);
    expect(new Set(stateVariants('Georgia')).size).toBe(2);
  });

  it('returns an empty list for blank input, so no query is built', () => {
    expect(stateVariants('')).toEqual([]);
    expect(stateVariants('   ')).toEqual([]);
    expect(stateVariants(null)).toEqual([]);
    expect(stateVariants(undefined)).toEqual([]);
  });

  it('passes an unknown value through rather than dropping it', () => {
    // A non-US or free-typed value must still produce an exact-match query;
    // returning [] here would turn "no match" into "no filter at all", which
    // silently reports EVERY record instead of none.
    expect(stateVariants('Ontario')).toEqual(['Ontario']);
  });

  it('trims surrounding whitespace', () => {
    expect(stateVariants('  Georgia ')).toContain('GA');
  });

  it('handles a state whose name is two words', () => {
    expect(stateVariants('South Carolina').sort()).toEqual(['SC', 'South Carolina']);
    expect(stateVariants('SC')).toContain('South Carolina');
  });
});
