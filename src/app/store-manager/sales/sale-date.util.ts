import { Timestamp } from 'firebase/firestore';

// SaleModel.startDate/endDate are typed `Timestamp | string` - newer records
// are 'yyyy-MM-dd' strings (from the original dxDateBox's
// dateSerializationFormat), older ones may still be raw Firestore
// Timestamps. This normalizes either shape to a plain Date for display and
// for seeding a MatDatepicker.
export function parseSaleDate(value: Timestamp | string | Date | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof (value as Timestamp).toDate === 'function') {
    return (value as Timestamp).toDate();
  }
  return null;
}
