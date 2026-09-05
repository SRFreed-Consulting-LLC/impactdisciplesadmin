// THE PRIVACY BOUNDARY OF THE PUBLIC READER MAP.
//
// `library_map/points` is world-readable (`allow read: if true`). It is
// derived from `libraryUsers`, which is owner-or-admin only and whose
// documents carry an email address, a phone number, a name, book licences
// and a last-login time.
//
// pointsFrom() is the whole of what separates those two facts, so what it
// DROPS matters more than what it keeps. These tests exist to fail loudly if
// a future change carries a field across that boundary - which would not
// break anything visible, and would publish it.

const test = require("node:test");
const assert = require("node:assert");

const {pointsFrom, jitterFor} = require("../lib/library-map.functions");

/**
 * A libraryUsers document as the trigger sees it.
 * @param {string} id The document id, which is the reader's email.
 * @param {object} extra Fields to merge in.
 * @return {Array} An [id, data] pair.
 */
function user(id, extra) {
  return [id, {
    email: id,
    firstName: "Ann",
    lastName: "Example",
    phone: "+1 555 0100",
    lastLogin: 1757030000000,
    licensedBookIds: ["book-1"],
    ...extra,
  }];
}

test("publishes where, and nothing about WHO", () => {
  const points = pointsFrom([
    user("ann@example.com", {location: {
      lat: 33.749, lng: -84.388,
      city: "Atlanta", region: "Georgia", country: "United States",
    }}),
  ]);

  assert.equal(points.length, 1);
  // The EXACT shape, not a subset check: a subset check passes when a new
  // field is added, which is the failure this file exists to catch. Place
  // names are here on purpose (2026-09-05, for the map's popup) and disclose
  // nothing the coordinate did not - a coordinate IS a place.
  assert.deepEqual(
    Object.keys(points[0]).sort(),
    ["city", "country", "lat", "lng", "region"]
  );

  // What must never cross: anything that says WHO.
  const published = JSON.stringify(points);
  for (const secret of ["ann@example.com", "Ann", "Example", "555", "book-1"]) {
    assert.ok(
      !published.includes(secret),
      `the published points leaked ${JSON.stringify(secret)}`
    );
  }
});

test("omits a place name rather than publishing an empty or odd one", () => {
  // Absent, not present-and-undefined: Firestore rejects a whole write over
  // one explicitly-undefined field, however deep.
  const points = pointsFrom([
    user("a@example.com", {location: {lat: 1, lng: 2, city: "  ", country: 7}}),
  ]);
  assert.deepEqual(Object.keys(points[0]).sort(), ["lat", "lng"]);
  assert.ok(!("city" in points[0]));
  assert.ok(!("country" in points[0]));
});

test("refuses a place name long enough to be something else", () => {
  // A field that should hold "Atlanta" holding a paragraph means something
  // upstream is wrong, and this document is world-readable.
  const points = pointsFrom([
    user("a@example.com", {location: {lat: 1, lng: 2, city: "x".repeat(400)}}),
  ]);
  assert.ok(!("city" in points[0]));
});

test("skips a reader with no usable location rather than plotting 0,0", () => {
  // A dot at 0,0 is the Gulf of Guinea. A permanent mystery reader in the sea
  // invites exactly one question, and it has no good answer.
  const points = pointsFrom([
    user("none@example.com", {}),
    user("null@example.com", {location: null}),
    user("empty@example.com", {location: {}}),
    user("text@example.com", {location: {lat: "33.7", lng: "-84.4"}}),
    user("nan@example.com", {location: {lat: NaN, lng: 0}}),
    user("far@example.com", {location: {lat: 95, lng: 0}}),
    user("real@example.com", {location: {lat: 33.749, lng: -84.388}}),
  ]);

  assert.equal(points.length, 1);
});

test("separates readers who share a city, and keeps each one put", () => {
  // IP geolocation returns a city centroid, so three readers in Atlanta
  // arrive with identical coordinates. Undisplaced they draw as one dot and
  // the map under-reports itself.
  const atlanta = {lat: 33.749, lng: -84.388};
  const points = pointsFrom([
    user("a@example.com", {location: atlanta}),
    user("b@example.com", {location: atlanta}),
    user("c@example.com", {location: atlanta}),
  ]);

  const distinct = new Set(points.map((p) => `${p.lat},${p.lng}`));
  assert.equal(distinct.size, 3, "three readers should draw three dots");

  // ...and none of them is the real coordinate.
  assert.ok(!points.some(
    (p) => p.lat === atlanta.lat && p.lng === atlanta.lng
  ));

  // Within a plausible distance of the city - a dot in the next state would
  // be a different kind of wrong.
  for (const p of points) {
    assert.ok(Math.abs(p.lat - atlanta.lat) < 0.1);
    assert.ok(Math.abs(p.lng - atlanta.lng) < 0.1);
  }
});

test("a reader's dot does not wander between rebuilds", () => {
  // The trigger recomputes the whole document on every write to any reader -
  // including the lastLogin stamp on every sign-in. A dot that moved each
  // time would read as somebody relocating twice an hour.
  const where = {location: {lat: 51.5072, lng: -0.1276}};
  const first = pointsFrom([user("same@example.com", where)]);
  const again = pointsFrom([user("same@example.com", where)]);

  assert.deepEqual(first, again);
  assert.deepEqual(
    jitterFor("same@example.com"), jitterFor("same@example.com")
  );
});

test("different readers get different offsets", () => {
  const a = jitterFor("a@example.com");
  const b = jitterFor("b@example.com");
  assert.notDeepEqual(a, b);
  for (const v of [...a, ...b]) {
    assert.ok(v >= -1 && v <= 1, `offset ${v} is outside [-1, 1]`);
  }
});
