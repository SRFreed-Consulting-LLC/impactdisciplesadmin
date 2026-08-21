/**
 * Normalises an event's `checkIn` to the `HH:mm` string an <input type="time">
 * (and the summit preview) expects.
 *
 * Extracted from EventsComponent 2026-08-21 (bucket A item #5): it had two
 * callers there - the edit form's buildForm() and the Mission Control preview
 * builder - and moving the latter into SummitHubComponent would otherwise have
 * meant a second copy. Stored check-in values are genuinely mixed: older docs
 * hold a Date, newer ones the plain 'HH:mm' string the input writes back, and
 * anything unparseable has to degrade to '' rather than 'NaN:NaN'.
 * @param {unknown} value The raw stored check-in value.
 * @return {string} 'HH:mm', or '' when absent/unparseable.
 */
export function toTimeValue(value: unknown): string {
  if (!value) return '';
  // Already the canonical form - don't round-trip it through Date, which
  // would reinterpret 'HH:mm' as a date and lose it.
  if (typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)) {
    return value;
  }
  const d = value instanceof Date ? value : new Date(value as string | number);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
