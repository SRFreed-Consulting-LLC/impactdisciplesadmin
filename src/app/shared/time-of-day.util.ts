import { Timestamp } from 'firebase/firestore';
import { dateFromTimestamp } from 'impactdisciplescommon/src/utils/date-from-timestamp';

// Lunch and Learn / Seminar requests store requestedStartTime/EndTime as full
// Timestamps, but every screen only ever displays and edits the time-of-day
// portion (the original dx-form used dxDateBox type="time", the grid cell
// templates only ever rendered `date: 'HH:mm'`). These two helpers translate
// between that Timestamp and the plain "HH:mm" string a native
// <input type="time"> control needs, so the reactive form can hold a normal
// string control instead of juggling Date objects directly.

export function timestampToTimeString(value: Timestamp | Date | string | null | undefined): string {
  const date = value instanceof Date ? value : dateFromTimestamp(value as any);
  if (!(date instanceof Date)) {
    return '';
  }
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// Combines a time-of-day string with the date portion of `onDate` (falling
// back to today when no date has been picked yet) into a Timestamp - mirrors
// how the original dxDateBox editors always carried a full Date under the
// hood even though only the time was ever shown to the user.
export function timeStringToTimestamp(time: string | null | undefined, onDate: Date | null | undefined): Timestamp | null {
  if (!time) {
    return null;
  }
  const [hours, minutes] = time.split(':').map((part) => parseInt(part, 10));
  const base = onDate instanceof Date ? new Date(onDate) : new Date();
  base.setHours(hours || 0, minutes || 0, 0, 0);
  return Timestamp.fromDate(base);
}

// Home Page Popups' fromDate/toDate are stored as a plain local-time string
// (the original dxDateBox editors used
// dateSerializationFormat: 'yyyy-MM-ddTHH:mm:ss'), not a Timestamp like
// every other date field in this app - preserved here rather than silently
// upgrading existing/new records to Timestamps. These three helpers move
// that value in and out of a native <input type="datetime-local">, whose
// own value format (`yyyy-MM-ddTHH:mm`, always local wall-clock time, no
// timezone) is a near-exact match for the stored shape already.

function toLocalDateTimeString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// NOTE: deliberately does NOT go through dateFromTimestamp() for the string
// case - that util has a known bug (see customer-dialog.component.ts's own
// comment on it) where any string input that isn't the literal
// 'dd/dd/dddd' shape is returned completely unparsed, which is actually
// exactly what's wanted here: these strings are already local wall-clock
// time in this screen's own format, so no Date parsing (and no risk of an
// unwanted timezone conversion) is needed - just take the yyyy-MM-ddTHH:mm
// prefix an <input type="datetime-local"> expects.
export function toDateTimeLocalValue(value: Timestamp | Date | string | null | undefined): string {
  if (!value) {
    return '';
  }
  if (typeof value === 'string') {
    return value.slice(0, 16);
  }
  const date = value instanceof Date ? value : (value as Timestamp).toDate?.();
  return date instanceof Date ? toLocalDateTimeString(date).slice(0, 16) : '';
}

// Inverse of toDateTimeLocalValue() - appends the :00 seconds component the
// original's stored strings always had (datetime-local's own value never
// includes seconds).
export function fromDateTimeLocalValue(value: string | null | undefined): string {
  return value ? `${value}:00` : '';
}
