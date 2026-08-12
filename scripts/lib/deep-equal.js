// Order-independent structural equality for Firestore document data (after
// toPortable() normalization). JSON.stringify-based comparison is NOT safe
// here - two independently-constructed JS objects holding identical data
// commonly differ in key insertion order (e.g. a doc round-tripped through
// export.js's JSON snapshot vs one read fresh via the Admin SDK), which
// JSON.stringify treats as a difference even though Firestore doesn't care
// about field order at all. Object keys are compared as a set; array
// elements are compared by index (arrays ARE order-sensitive - that's real
// data, not incidental construction order).

/**
 * Deep-equality check, ignoring object key order.
 * @param {*} a First value (already run through toPortable()).
 * @param {*} b Second value (already run through toPortable()).
 * @return {boolean} Whether they're structurally equivalent.
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) {
    return a === b;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

module.exports = {deepEqual};
