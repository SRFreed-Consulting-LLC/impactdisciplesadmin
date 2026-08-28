import {Timestamp} from "firebase-admin/firestore";

// Functions-side twin of the client's defensive date normalization
// (src/common/src/shared/utils/date-from-timestamp.ts) - keep the two in
// sync. NOTE the path: the twin moved into the SHARED SUBMODULE in the
// 2026-08-20 move, so a change there reaches web and reader as well as this
// app, and needs the submodule pushed first plus a pointer bump in each
// consumer. This pointer named the old pre-move path until 2026-08-28 - the
// cross-reference IS the entire safety mechanism for a manual mirror, so it
// rotting was the real defect, not the duplication.
//
// Better fix, deliberately not taken today: the shared file is already
// dependency-free and its own header says "and eventually functions", so it
// could be added to functions/scripts/sync-shared.js's EXTRA_FILES and this
// mirror deleted outright. That was left alone because this is the date
// normalization the sales-tax trigger depends on (a bug fixed here on
// 2026-08-28 filed tax under the wrong year), and swapping the
// implementation on that path deserves its own change with its own
// verification rather than riding along inside a comment fix. The two are
// behaviourally aligned today.
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
