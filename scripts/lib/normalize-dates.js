// Normalizes the specific date fields MIGRATION.md documented as existing
// in 3 inconsistent shapes in the same collection (real Timestamp /
// malformed {seconds,nanoseconds} map / plain string). Scoped to exactly
// the 2 fields that were actually confirmed affected - don't guess at
// others; extend FIELDS_BY_COLLECTION deliberately if more turn up.

const FIELDS_BY_COLLECTION = {
  purchases: ["dateProcessed"],
  events: ["startDate"],
};

/**
 * Normalizes one field value into a real Firestore Timestamp if it isn't
 * already one.
 * @param {*} value The raw field value.
 * @param {typeof import("firebase-admin").firestore} firestoreNs
 * `admin.firestore` namespace (for the Timestamp constructor).
 * @return {{value: *, changed: boolean, warning?: string}} The (possibly
 * unchanged) value, whether it was changed, and an optional warning if a
 * string value couldn't be parsed as a date.
 */
function normalizeValue(value, firestoreNs) {
  if (value === null || value === undefined) {
    return {value, changed: false};
  }
  if (value instanceof firestoreNs.Timestamp) {
    return {value, changed: false};
  }
  // Malformed plain map - e.g. what you get back after a naive
  // JSON.stringify/parse round-trip of a real Timestamp, with no
  // Timestamp prototype attached.
  if (typeof value === "object" && typeof value.seconds === "number" &&
      typeof value.nanoseconds === "number") {
    return {
      value: new firestoreNs.Timestamp(value.seconds, value.nanoseconds),
      changed: true,
    };
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return {value: firestoreNs.Timestamp.fromDate(parsed), changed: true};
    }
    return {value, changed: false, warning: `unparseable date string "${value}"`};
  }
  return {value, changed: false};
}

/**
 * Normalizes every known-affected date field on one document's data.
 * @param {string} collectionName Collection the doc belongs to.
 * @param {Object} data Document data (already Timestamp/GeoPoint-restored,
 * not the portable JSON form).
 * @param {typeof import("firebase-admin").firestore} firestoreNs
 * `admin.firestore` namespace.
 * @return {{data: Object, changed: boolean, warnings: string[]}} A new data
 * object (input is not mutated), whether anything changed, and any
 * unparseable-value warnings.
 */
function normalizeDoc(collectionName, data, firestoreNs) {
  const fields = FIELDS_BY_COLLECTION[collectionName];
  if (!fields || !data) {
    return {data, changed: false, warnings: []};
  }
  let changed = false;
  const warnings = [];
  const out = {...data};
  for (const field of fields) {
    if (!(field in out)) continue;
    const result = normalizeValue(out[field], firestoreNs);
    out[field] = result.value;
    if (result.changed) changed = true;
    if (result.warning) warnings.push(`${collectionName}.${field}: ${result.warning}`);
  }
  return {data: out, changed, warnings};
}

module.exports = {normalizeDoc, FIELDS_BY_COLLECTION};
