import {Timestamp} from "firebase-admin/firestore";

// Functions-side twin of the client's defensive date normalization
// (src/app/common/utils/date-from-timestamp.ts) - keep the two in sync.
// The purchases/event-registrations collections carry dates in several
// shapes (real Timestamp, Date, ISO string, "MM/dd/yyyy" string, and a
// malformed plain {seconds, nanoseconds} map - see MIGRATION.md), and any
// server-side elapsed-time or anchor-date logic must survive all of them.

/**
 * Best-effort conversion of any of the date shapes found in this database
 * to epoch milliseconds. Returns 0 when nothing parseable is present -
 * callers treat 0 as "no usable date".
 * @param {unknown} item The stored value.
 * @return {number} Epoch millis, or 0.
 */
export function toMillis(item: unknown): number {
  if (!item) {
    return 0;
  }
  if (item instanceof Timestamp) {
    return item.toMillis();
  }
  if (item instanceof Date) {
    return isNaN(item.getTime()) ? 0 : item.getTime();
  }
  if (typeof item === "string" || typeof item === "number") {
    const parsed = new Date(item);
    return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }
  // The malformed {seconds, nanoseconds} plain-map shape.
  const seconds = (item as {seconds?: unknown}).seconds;
  if (typeof seconds === "number" && isFinite(seconds)) {
    return seconds * 1000;
  }
  return 0;
}

/**
 * Same normalization, returned as a real Timestamp (or null when nothing
 * parseable is present).
 * @param {unknown} item The stored value.
 * @return {Timestamp | null} Normalized timestamp.
 */
export function toTimestamp(item: unknown): Timestamp | null {
  const millis = toMillis(item);
  return millis > 0 ? Timestamp.fromMillis(millis) : null;
}
