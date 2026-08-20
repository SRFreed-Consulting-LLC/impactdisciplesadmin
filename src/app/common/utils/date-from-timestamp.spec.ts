import { Timestamp } from 'firebase/firestore';
import { dateFromTimestamp, toMillis } from './date-from-timestamp';

// 2024-01-15T00:00:00Z
const SECONDS = 1705276800;
const MILLIS = SECONDS * 1000;

describe('dateFromTimestamp', () => {
  it('returns a real Date untouched (same instance)', () => {
    const date = new Date(2024, 0, 15, 12, 30);
    expect(dateFromTimestamp(date)).toBe(date);
  });

  it('converts a genuine Firestore Timestamp via its seconds', () => {
    const result = dateFromTimestamp(new Timestamp(SECONDS, 0));
    expect(result instanceof Date).toBeTrue();
    expect(result.getTime()).toBe(MILLIS);
  });

  it('converts a malformed plain {seconds, nanoseconds} map the same way', () => {
    const result = dateFromTimestamp({ seconds: SECONDS, nanoseconds: 123 });
    expect(result instanceof Date).toBeTrue();
    expect(result.getTime()).toBe(MILLIS);
  });

  it('parses an "MM/dd/yyyy" string into a local-midnight Date', () => {
    const result = dateFromTimestamp('01/15/2024');
    expect(result instanceof Date).toBeTrue();
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(15);
    expect(result.getHours()).toBe(0);
  });

  it('returns null for an "MM/dd/yyyy"-shaped string that is not a real date', () => {
    expect(dateFromTimestamp('13/45/2024')).toBeNull();
  });

  it('passes an ISO string through UNPARSED (documented: only MM/dd/yyyy is parsed here - toMillis covers ISO)', () => {
    expect(dateFromTimestamp('2026-01-30T02:00:00')).toBe('2026-01-30T02:00:00');
  });

  it('passes an arbitrary non-date string through unparsed too', () => {
    expect(dateFromTimestamp('hello')).toBe('hello');
  });

  it('returns null for null, undefined, and other falsy input', () => {
    expect(dateFromTimestamp(null)).toBeNull();
    expect(dateFromTimestamp(undefined)).toBeNull();
    expect(dateFromTimestamp('')).toBeNull();
    expect(dateFromTimestamp(0)).toBeNull();
  });

  it('returns null for an object with no usable seconds field', () => {
    expect(dateFromTimestamp({ foo: 'bar' })).toBeNull();
    // seconds: 0 is falsy, so the map branch never runs - epoch maps fall out as null.
    expect(dateFromTimestamp({ seconds: 0, nanoseconds: 0 })).toBeNull();
  });

  it('returns null for a bare number (numbers only work through toMillis)', () => {
    expect(dateFromTimestamp(MILLIS)).toBeNull();
  });
});

describe('toMillis', () => {
  it('converts a real Date', () => {
    expect(toMillis(new Date(MILLIS))).toBe(MILLIS);
  });

  it('converts a genuine Firestore Timestamp', () => {
    expect(toMillis(new Timestamp(SECONDS, 0))).toBe(MILLIS);
  });

  it('converts a malformed {seconds, nanoseconds} map', () => {
    expect(toMillis({ seconds: SECONDS, nanoseconds: 0 })).toBe(MILLIS);
  });

  it('converts an "MM/dd/yyyy" string (local midnight)', () => {
    expect(toMillis('01/15/2024')).toBe(new Date(2024, 0, 15).getTime());
  });

  it('converts an ISO string via the native-Date fallback', () => {
    const iso = '2024-01-15T00:00:00.000Z';
    expect(toMillis(iso)).toBe(MILLIS);
  });

  it('converts a millis number via the native-Date fallback', () => {
    expect(toMillis(MILLIS)).toBe(MILLIS);
  });

  it('falls back to 0 for null, undefined, and garbage', () => {
    expect(toMillis(null)).toBe(0);
    expect(toMillis(undefined)).toBe(0);
    expect(toMillis('not a date at all')).toBe(0);
    expect(toMillis({ foo: 'bar' })).toBe(0);
  });
});
