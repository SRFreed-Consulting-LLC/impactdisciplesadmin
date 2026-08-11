import { Timestamp } from 'firebase/firestore';

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
