// Unit tests for the functions-side date normalizer (twin of the client's
// date-from-timestamp.ts). Every date shape found in this database - see
// MIGRATION.md - must normalize without throwing.
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {Timestamp} = require("firebase-admin/firestore");

const {toMillis, toTimestamp} =
  require("../lib/utils/date-normalize.functions");

const KNOWN_MS = Date.UTC(2026, 7, 1, 12, 0, 0); // 2026-08-01T12:00:00Z

test("real Timestamp", () => {
  assert.equal(toMillis(Timestamp.fromMillis(KNOWN_MS)), KNOWN_MS);
});

test("Date object", () => {
  assert.equal(toMillis(new Date(KNOWN_MS)), KNOWN_MS);
  assert.equal(toMillis(new Date("garbage")), 0);
});

test("ISO string and MM/dd/yyyy string", () => {
  assert.equal(toMillis("2026-08-01T12:00:00.000Z"), KNOWN_MS);
  assert.ok(toMillis("08/01/2026") > 0);
});

test("malformed plain {seconds, nanoseconds} map", () => {
  assert.equal(
    toMillis({seconds: KNOWN_MS / 1000, nanoseconds: 0}),
    KNOWN_MS
  );
});

test("epoch-millis number passes through new Date()", () => {
  assert.equal(toMillis(KNOWN_MS), KNOWN_MS);
});

test("unparseable input normalizes to 0", () => {
  assert.equal(toMillis(null), 0);
  assert.equal(toMillis(undefined), 0);
  assert.equal(toMillis("not a date"), 0);
  assert.equal(toMillis({}), 0);
  assert.equal(toMillis({seconds: "NaNish"}), 0);
});

test("toTimestamp wraps toMillis, null for unusable", () => {
  const ts = toTimestamp("2026-08-01T12:00:00.000Z");
  assert.equal(ts.toMillis(), KNOWN_MS);
  assert.equal(toTimestamp("junk"), null);
  assert.equal(toTimestamp(null), null);
});
