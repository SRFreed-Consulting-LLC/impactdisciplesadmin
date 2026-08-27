// Unit tests for coupon resolution (utils/coupons.ts).
//
// Every case here is a defect the store checkout path actually had before
// 2026-08-27, when it resolved codes with
// `where("code", "==", code).limit(1)` while the other three coupon paths
// scanned and filtered. They are pinned because each failure is SILENT -
// the shopper is simply charged more than the cart showed them.
//
// Runs against ../lib via `npm test`.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {Timestamp} = require("firebase-admin/firestore");

const {
  isCouponExpired,
  pickActiveCoupon,
} = require("../lib/utils/coupons");

const SAVE_15 = {code: "SAVE", percentOff: 15, isActive: true};
const SAVE_10_RETIRED = {code: "SAVE", percentOff: 10, isActive: false};

test("matches a code case-insensitively", () => {
  // The live bug: lookup_coupon told the shopper "applied" for "save",
  // the cart persisted "save", and the exact-match checkout query found
  // nothing - full price, no error.
  assert.equal(pickActiveCoupon([SAVE_15], "save")?.percentOff, 15);
  assert.equal(pickActiveCoupon([SAVE_15], "SaVe")?.percentOff, 15);
  assert.equal(pickActiveCoupon([SAVE_15], "SAVE")?.percentOff, 15);
});

test("trims surrounding whitespace on the entered code", () => {
  assert.equal(pickActiveCoupon([SAVE_15], "  save ")?.percentOff, 15);
});

test("skips an INACTIVE twin and finds the live coupon", () => {
  // Prod really does hold two SAVE coupons. `limit(1)` returned whichever
  // sorted first by document id; when that was the retired one the live
  // coupon was rejected outright.
  assert.equal(
    pickActiveCoupon([SAVE_10_RETIRED, SAVE_15], "SAVE")?.percentOff,
    15
  );
  assert.equal(
    pickActiveCoupon([SAVE_15, SAVE_10_RETIRED], "SAVE")?.percentOff,
    15
  );
});

test("returns undefined when every match is inactive", () => {
  assert.equal(pickActiveCoupon([SAVE_10_RETIRED], "SAVE"), undefined);
});

test("isActive must be EXACTLY true, not merely truthy", () => {
  assert.equal(pickActiveCoupon([{code: "X", isActive: 1}], "X"), undefined);
  assert.equal(
    pickActiveCoupon([{code: "X", isActive: "true"}], "X"),
    undefined
  );
  assert.equal(pickActiveCoupon([{code: "X"}], "X"), undefined);
});

test("returns undefined for a blank or missing code", () => {
  assert.equal(pickActiveCoupon([SAVE_15], ""), undefined);
  assert.equal(pickActiveCoupon([SAVE_15], "   "), undefined);
  assert.equal(pickActiveCoupon([SAVE_15], null), undefined);
  assert.equal(pickActiveCoupon([SAVE_15], undefined), undefined);
});

test("returns undefined when nothing matches", () => {
  assert.equal(pickActiveCoupon([SAVE_15], "NOPE"), undefined);
  assert.equal(pickActiveCoupon([], "SAVE"), undefined);
});

test("an expired coupon is not picked, in every stored shape", () => {
  const past = Date.now() - 60_000;
  const shapes = [
    Timestamp.fromMillis(past), // real Firestore Timestamp
    new Date(past), // Date
    new Date(past).toISOString(), // ISO string
    past, // epoch millis
    // The malformed plain-map shape a serialized Timestamp leaves behind.
    // Parsed by toMillis; a hand-rolled new Date() yields NaN here and
    // would read as "never expires".
    {seconds: Math.floor(past / 1000), nanoseconds: 0},
  ];
  for (const expiresAt of shapes) {
    assert.equal(
      pickActiveCoupon([{...SAVE_15, expiresAt}], "SAVE"),
      undefined,
      `expected expired for ${JSON.stringify(expiresAt)}`
    );
  }
});

test("a future expiry still resolves", () => {
  const future = Date.now() + 60_000;
  assert.equal(
    pickActiveCoupon([{...SAVE_15, expiresAt: future}], "SAVE")?.percentOff,
    15
  );
});

test("no expiry means it never expires", () => {
  // Every coupon written before Campaign Manager v3 has no expiresAt at
  // all - none of them may start being refused.
  assert.equal(isCouponExpired(undefined), false);
  assert.equal(isCouponExpired(null), false);
  assert.equal(pickActiveCoupon([SAVE_15], "SAVE")?.percentOff, 15);
});

test("an unparseable expiry is treated as no expiry", () => {
  // Refusing a valid coupon because its expiry is malformed would be a
  // worse failure than honouring it.
  assert.equal(isCouponExpired("not a date"), false);
  assert.equal(isCouponExpired(0), false);
});
