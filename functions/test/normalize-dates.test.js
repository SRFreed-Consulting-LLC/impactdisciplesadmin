// Tests scripts/lib/normalize-dates.js - the one-time Firestore date-shape
// repair, not functions' own date-normalize mirror (that has its own suite
// next door in date-normalize.test.js).
//
// It lives HERE rather than under scripts/ for the same reason
// tenancy-mirror.test.js does: functions/ is the only project in this repo
// with a node:test runner wired up, and `npm run check-functions` - which
// both build-deploy scripts run first - is the thing that will actually
// execute it.
//
// WHY THIS EXISTS AT ALL. The array walker added on 2026-09-04 is the whole
// of what repairs the remaining bad data, and every failure mode it has is
// silent: a path that never matches leaves the value untouched and reports
// success, and a naive date string parsed in the wrong timezone produces a
// perfectly plausible instant that is simply wrong.

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const functionsDir = path.join(__dirname, "..");
const firestore = require(
  require.resolve("firebase-admin/firestore", {paths: [functionsDir]})
);

const {
  normalizeDoc,
  normalizeValue,
  isNaiveString,
  assertLocalTimezone,
  FIELDS_BY_COLLECTION,
} = require("../../scripts/lib/normalize-dates");

const {Timestamp} = firestore;

// The exact shape found live: a Timestamp that lost its prototype through a
// JSON round-trip. Looks like a Timestamp, sorts like a map.
const malformedMap = (seconds, nanoseconds = 0) => ({seconds, nanoseconds});

test("converts a malformed seconds/nanoseconds map to a Timestamp", () => {
  const result = normalizeValue(malformedMap(1738528049, 872000000), firestore);

  assert.strictEqual(result.changed, true);
  assert.ok(result.value instanceof Timestamp);
  // The INSTANT must survive exactly - this is the whole point. A repair
  // that shifted the moment would be worse than the bug it fixes.
  assert.strictEqual(result.value.seconds, 1738528049);
  assert.strictEqual(result.value.nanoseconds, 872000000);
});

test("leaves a real Timestamp alone", () => {
  const original = Timestamp.fromDate(new Date("2026-01-30T18:30:00.000Z"));
  const result = normalizeValue(original, firestore);

  assert.strictEqual(result.changed, false);
  assert.strictEqual(result.value, original);
});

test("leaves an epoch-millis NUMBER alone", () => {
  // The library and reader collections store dates this way on purpose.
  // Converting them would break the reader, which reads them as numbers.
  const result = normalizeValue(1700000000000, firestore);

  assert.strictEqual(result.changed, false);
  assert.strictEqual(result.value, 1700000000000);
});

test("converts an ISO string that carries a timezone", () => {
  const result = normalizeValue("2026-01-30T18:30:00.000Z", firestore);

  assert.strictEqual(result.changed, true);
  assert.strictEqual(
    result.value.toDate().toISOString(), "2026-01-30T18:30:00.000Z");
});

test("keeps an unparseable string and warns rather than nulling it", () => {
  const result = normalizeValue("not a date", firestore);

  assert.strictEqual(result.changed, false);
  assert.strictEqual(result.value, "not a date");
  assert.match(result.warning, /unparseable/);
});

test("recognises which ISO strings are timezone-naive", () => {
  assert.strictEqual(isNaiveString("2025-09-29T03:00:00"), true);
  assert.strictEqual(isNaiveString("2026-01-30T18:30:00.000Z"), false);
  assert.strictEqual(isNaiveString("2026-01-30T18:30:00+05:00"), false);
  assert.strictEqual(isNaiveString("11/30/2025"), false);
});

test("refuses to convert naive strings from the wrong timezone", () => {
  // The guard is the point: a naive "03:00:00" means 3am where it was
  // typed, and parsing it elsewhere silently moves the event.
  assert.throws(
    () => assertLocalTimezone("Pacific/Auckland"),
    /Refusing to convert naive date strings/
  );
});

test("walks into an array and fixes each element", () => {
  // purchases.cartItems[].dateProcessed - 882 malformed maps across both
  // projects, and invisible to the top-level-only walker this replaced.
  const doc = {
    dateProcessed: Timestamp.fromDate(new Date("2025-02-02T20:27:29.000Z")),
    cartItems: [
      {itemName: "Book", dateProcessed: malformedMap(1738528049, 872000000)},
      {itemName: "Card", dateProcessed: malformedMap(1738528049, 872000000)},
    ],
  };

  const {data, changed} = normalizeDoc("purchases", doc, firestore);

  assert.strictEqual(changed, true);
  assert.ok(data.cartItems[0].dateProcessed instanceof Timestamp);
  assert.ok(data.cartItems[1].dateProcessed instanceof Timestamp);
  // Untouched sibling fields on the element must survive intact.
  assert.strictEqual(data.cartItems[0].itemName, "Book");
});

test("does not mutate the document it was given", () => {
  const element = {dateProcessed: malformedMap(1738528049)};
  const doc = {cartItems: [element]};

  normalizeDoc("purchases", doc, firestore);

  assert.deepStrictEqual(
    element.dateProcessed, {seconds: 1738528049, nanoseconds: 0});
});

test("reports no change for a document that is already clean", () => {
  const doc = {
    dateProcessed: Timestamp.fromDate(new Date("2025-02-02T20:27:29.000Z")),
    cartItems: [
      {itemName: "Book", dateProcessed: Timestamp.fromDate(new Date())},
    ],
  };

  const {data, changed} = normalizeDoc("purchases", doc, firestore);

  assert.strictEqual(changed, false);
  // Same array instance back - a caller diffing before/after sees nothing.
  assert.strictEqual(data.cartItems, doc.cartItems);
});

test("ignores an array field that is not an array, and a missing one", () => {
  assert.strictEqual(
    normalizeDoc("purchases", {cartItems: "nope"}, firestore).changed, false);
  assert.strictEqual(normalizeDoc("purchases", {}, firestore).changed, false);
});

test("skips a non-object element rather than throwing on it", () => {
  const doc = {cartItems: [null, "junk", {dateProcessed: malformedMap(1)}]};

  const {data, changed} = normalizeDoc("purchases", doc, firestore);

  assert.strictEqual(changed, true);
  assert.strictEqual(data.cartItems[0], null);
  assert.strictEqual(data.cartItems[1], "junk");
  assert.ok(data.cartItems[2].dateProcessed instanceof Timestamp);
});

test("leaves a collection it knows nothing about untouched", () => {
  const doc = {createdAt: 1700000000000};
  const {data, changed} = normalizeDoc("libraryUsers", doc, firestore);

  assert.strictEqual(changed, false);
  assert.strictEqual(data, doc);
});

test("covers every collection and path the live sweep found", () => {
  // Pins the SET, not just the walker. A field quietly dropped from this
  // list is a field that silently stops being repaired.
  assert.deepStrictEqual(Object.keys(FIELDS_BY_COLLECTION).sort(), [
    "customers", "event-registrations", "events", "purchases",
  ]);
  const purchaseFields = FIELDS_BY_COLLECTION.purchases;
  assert.ok(purchaseFields.includes("cartItems[].dateProcessed"));
  assert.ok(FIELDS_BY_COLLECTION.events.includes("agendaItems[].startDate"));
  assert.ok(FIELDS_BY_COLLECTION.customers.includes("notes[].date"));
});
