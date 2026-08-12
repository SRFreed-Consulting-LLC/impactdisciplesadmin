// Fields that must never cross the Prod<->Dev boundary in either direction
// - each environment has (or should have) its own independent value, and
// blindly copying one over the other silently repoints something live.
// Applied globally (not per-collection) since none of these field names
// collide with an unrelated field elsewhere - same convention as
// firebaseUID's handling in promote.js.
//
// paypalClientId (on the `config` doc): live-diagnosed 2026-08-12 - a Dev
// wipe-and-reimport from Prod overwrote Dev's PayPal SANDBOX client id with
// Prod's real LIVE one, meaning a checkout test in Dev would have created
// a real, live PayPal transaction. Restored by hand once; this list is what
// stops it happening silently again on the next import/promote run.
const NEVER_OVERWRITE_FIELDS = new Set([
  "firebaseUID",
  "paypalClientId",
]);

/**
 * Removes NEVER_OVERWRITE_FIELDS keys from a doc's data before it's written
 * across the Prod<->Dev boundary, so merge:true leaves whatever the
 * destination already has for that field untouched.
 * @param {Object} data Document data.
 * @return {Object} A new object with protected fields removed (input not
 * mutated).
 */
function stripProtectedFields(data) {
  const out = {...data};
  for (const f of NEVER_OVERWRITE_FIELDS) {
    delete out[f];
  }
  return out;
}

module.exports = {NEVER_OVERWRITE_FIELDS, stripProtectedFields};
