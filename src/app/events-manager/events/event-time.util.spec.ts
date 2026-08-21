import { toTimeValue } from './event-time.util';

// Pins the behaviour this had as EventsComponent's private toTimeValue()
// before it was extracted (bucket A item #5). Two callers depend on it - the
// edit form's check-in control and the Mission Control preview - so a change
// here is a change to both.
describe('toTimeValue', () => {
  it('passes an already-canonical HH:mm string straight through', () => {
    // Must NOT round-trip through Date: new Date('09:30') is invalid, which
    // would silently blank a check-in time that was already correct.
    expect(toTimeValue('09:30')).toBe('09:30');
    expect(toTimeValue('00:00')).toBe('00:00');
    expect(toTimeValue('23:59')).toBe('23:59');
  });

  it('formats a Date as zero-padded local HH:mm', () => {
    expect(toTimeValue(new Date(2026, 8, 1, 9, 5))).toBe('09:05');
    expect(toTimeValue(new Date(2026, 8, 1, 14, 30))).toBe('14:30');
  });

  it('parses a date-like string', () => {
    expect(toTimeValue('2026-09-01T08:07:00')).toBe('08:07');
  });

  it('returns empty string for absent values', () => {
    expect(toTimeValue(null)).toBe('');
    expect(toTimeValue(undefined)).toBe('');
    expect(toTimeValue('')).toBe('');
  });

  it('returns empty string rather than NaN:NaN for unparseable input', () => {
    expect(toTimeValue('not a time')).toBe('');
    expect(toTimeValue(new Date('nonsense'))).toBe('');
    expect(toTimeValue({})).toBe('');
  });

  it('treats a non-padded time string as date-like, not canonical', () => {
    // '9:30' fails the /^\d{2}:\d{2}$/ guard, so it goes down the Date path
    // and is unparseable - pinned because it is a real shape a hand-edited
    // doc could hold, and '' is what the form shows for it today.
    expect(toTimeValue('9:30')).toBe('');
  });
});
