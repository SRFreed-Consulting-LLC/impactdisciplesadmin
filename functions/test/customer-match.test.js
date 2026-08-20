// Unit tests for the customer-matching normalizers shared by the purchase
// and event-registration upsert triggers. Runs against ../lib via `npm test`.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {normalizedName, normalizedPhoneDigits, isPlausibleEmail} =
  require("../lib/utils/customer-match.functions");

test("normalizedName: trim + lowercase", () => {
  assert.equal(normalizedName("  Rick "), "rick");
  assert.equal(normalizedName("RICK"), "rick");
});

test("normalizedName: strips diacritics to the base letter", () => {
  assert.equal(normalizedName("Hernández"), "hernandez");
  assert.equal(normalizedName("Zoë"), "zoe");
});

test("normalizedName: non-strings normalize to empty", () => {
  assert.equal(normalizedName(null), "");
  assert.equal(normalizedName(undefined), "");
  assert.equal(normalizedName(42), "");
  assert.equal(normalizedName({}), "");
});

test("normalizedPhoneDigits: formatting stripped to digits", () => {
  assert.equal(normalizedPhoneDigits("(678) 223-5312"), "6782235312");
  assert.equal(normalizedPhoneDigits("678.223.5312"), "6782235312");
});

test("normalizedPhoneDigits: leading US country code stripped", () => {
  assert.equal(normalizedPhoneDigits("1 678.223.5312"), "6782235312");
  assert.equal(normalizedPhoneDigits("16782235312"), "6782235312");
});

test("normalizedPhoneDigits: 11 digits NOT starting with 1 all kept", () => {
  assert.equal(normalizedPhoneDigits("26782235312"), "26782235312");
});

test("normalizedPhoneDigits: null/undefined normalize to empty", () => {
  assert.equal(normalizedPhoneDigits(null), "");
  assert.equal(normalizedPhoneDigits(undefined), "");
});

test("isPlausibleEmail: accepts a normal address", () => {
  assert.equal(isPlausibleEmail("a@b.co"), true);
  assert.equal(isPlausibleEmail("  a@b.co  "), true);
});

test("isPlausibleEmail: rejects the live-diagnosed garbage shapes", () => {
  assert.equal(isPlausibleEmail("x"), false);
  assert.equal(isPlausibleEmail(""), false);
  assert.equal(isPlausibleEmail("@b.co"), false); // no local part
  assert.equal(isPlausibleEmail("a@"), false); // no domain
  assert.equal(isPlausibleEmail("a@b"), false); // no dot after the @
  assert.equal(isPlausibleEmail("a.b@c"), false); // dot only BEFORE the @
  assert.equal(isPlausibleEmail(null), false);
  assert.equal(isPlausibleEmail(123), false);
});
