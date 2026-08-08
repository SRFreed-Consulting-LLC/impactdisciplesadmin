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
