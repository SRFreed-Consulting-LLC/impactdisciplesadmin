// Round-trip-safe JSON encoding for Firestore document data. Plain
// JSON.stringify silently mangles Firestore's non-JSON-native types
// (Timestamp, GeoPoint, DocumentReference), which is exactly how the 3-shape
// date-field mess documented in MIGRATION.md happened in the first place -
// so export.js/import.js/promote.js all go through this instead of calling
// JSON.stringify/parse directly on raw doc data.
//
// Encoded shape: { __datatype__: "timestamp" | "geopoint" | "documentReference", ... }
// Chosen to be visibly distinct from any real field shape in this app's
// collections (grep for "__datatype__" if a snapshot ever needs eyeballing).

/**
 * Recursively converts one Firestore doc-data value into a plain,
 * JSON.stringify-safe value, tagging any Timestamp/GeoPoint/DocumentReference
 * it finds along the way.
 * @param {*} value Any value that can appear in Firestore document data.
 * @return {*} A plain value safe to pass to JSON.stringify.
 */
function toPortable(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value.toDate === "function" && typeof value.seconds === "number") {
    // admin.firestore.Timestamp
    return {
      __datatype__: "timestamp",
      seconds: value.seconds,
      nanoseconds: value.nanoseconds,
    };
  }
  if (typeof value.latitude === "number" && typeof value.longitude === "number" &&
      value.constructor && value.constructor.name === "GeoPoint") {
    return {
      __datatype__: "geopoint",
      latitude: value.latitude,
      longitude: value.longitude,
    };
  }
  if (value.constructor && value.constructor.name === "DocumentReference") {
    return {__datatype__: "documentReference", path: value.path};
  }
  if (Array.isArray(value)) {
    return value.map(toPortable);
  }
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = toPortable(v);
    }
    return out;
  }
  return value;
}

/**
 * Reverses toPortable() - reconstitutes Timestamp/GeoPoint/DocumentReference
 * instances from a JSON snapshot before writing it back to Firestore.
 * @param {*} value A value previously produced by toPortable().
 * @param {import("firebase-admin").firestore.Firestore} db Target Firestore
 * instance - needed to rebuild DocumentReferences against the right project.
 * @param {typeof import("firebase-admin").firestore} firestoreNs The
 * `admin.firestore` namespace (for its Timestamp/GeoPoint constructors).
 * @return {*} A value safe to write to Firestore.
 */
function fromPortable(value, db, firestoreNs) {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => fromPortable(v, db, firestoreNs));
  }
  if (typeof value === "object") {
    if (value.__datatype__ === "timestamp") {
      return new firestoreNs.Timestamp(value.seconds, value.nanoseconds);
    }
    if (value.__datatype__ === "geopoint") {
      return new firestoreNs.GeoPoint(value.latitude, value.longitude);
    }
    if (value.__datatype__ === "documentReference") {
      return db.doc(value.path);
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = fromPortable(v, db, firestoreNs);
    }
    return out;
  }
  return value;
}

module.exports = {toPortable, fromPortable};
