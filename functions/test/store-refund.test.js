// Unit tests for the refund money math (store-refund.functions.ts's
// chargedCents + computeRefundPlan - the two helpers the file itself marks
// as "extracted for unit testing"). Runs against ../lib via `npm test`;
// no emulator, no Firebase app - the module takes its Firestore handle
// inside each function precisely so this suite can require it.
//
// Why this suite matters: refundStorePurchase is the only code in the suite
// that moves money BACK OUT, and until 2026-08-21 it had no coverage of any
// kind (the emulator suites cover checkout pricing and license grants, not
// refunds). Every assertion below is about not over-refunding: the amounts
// are integer CENTS on purpose - float dollars are what these guards exist
// to prevent.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {chargedCents, computeRefundPlan, needsPaypalRefundFor} =
  require("../lib/store-refund.functions");

/** A purchase whose PayPal receipt says it captured `value` dollars. */
function withReceipt(value, extra = {}) {
  return {
    payPalReceipt: {purchase_units: [{amount: {value}}]},
    ...extra,
  };
}

/**
 * Asserts that `fn` throws an HttpsError carrying `code`.
 * @param {Function} fn The call under test.
 * @param {string} code Expected HttpsError code, e.g. "invalid-argument".
 * @param {string} message Assertion label.
 */
function assertHttpsError(fn, code, message) {
  assert.throws(fn, (err) => {
    assert.equal(err.code, code, `${message}: expected code ${code}`);
    return true;
  }, message);
}

// --------------------------------------------------------- chargedCents

test("chargedCents prefers the PayPal receipt's captured value", () => {
  // total/discount disagree with the receipt on purpose - what PayPal
  // actually captured wins, since that is what can be refunded.
  assert.equal(chargedCents(withReceipt("42.50", {total: 99, discount: 0})),
    4250);
});

test("chargedCents falls back to total - discount with no receipt", () => {
  assert.equal(chargedCents({total: 30, discount: 5}), 2500);
  assert.equal(chargedCents({total: 30}), 3000);
  assert.equal(chargedCents({}), 0);
});

test("chargedCents falls back when the receipt value is malformed", () => {
  assert.equal(chargedCents(withReceipt("not-a-number", {total: 12})), 1200);
  assert.equal(chargedCents(withReceipt(undefined, {total: 12})), 1200);
  assert.equal(chargedCents({payPalReceipt: {}, total: 12}), 1200);
  assert.equal(chargedCents({payPalReceipt: {purchase_units: []}, total: 12}),
    1200);
});

test("chargedCents is never negative (discount exceeding total)", () => {
  assert.equal(chargedCents({total: 10, discount: 25}), 0);
  assert.equal(chargedCents(withReceipt("-5")), 0);
});

test("chargedCents rounds to whole cents (float safety)", () => {
  assert.equal(chargedCents(withReceipt("0.1")), 10);
  assert.equal(chargedCents({total: 0.1 + 0.2}), 30); // 0.30000000000000004
  assert.equal(chargedCents(withReceipt("19.995")), 2000);
});

// ----------------------------------------------------- computeRefundPlan

test("a null amount means refund the whole remainder", () => {
  const plan = computeRefundPlan(withReceipt("40.00"), null, true);
  assert.deepEqual(plan,
    {requestedCents: 4000, remainingCents: 4000, isFullRefund: true});
});

test("undefined amount behaves the same as null", () => {
  const plan = computeRefundPlan(withReceipt("40.00"), undefined, true);
  assert.equal(plan.requestedCents, 4000);
  assert.equal(plan.isFullRefund, true);
});

test("a valid partial amount is planned and flagged as partial", () => {
  const plan = computeRefundPlan(withReceipt("40.00"), 15, true);
  assert.deepEqual(plan,
    {requestedCents: 1500, remainingCents: 4000, isFullRefund: false});
});

test("a partial that exactly equals the remainder IS a full refund", () => {
  const plan = computeRefundPlan(withReceipt("40.00"), 40, true);
  assert.equal(plan.isFullRefund, true);
});

test("a prior partial refund shrinks the remainder", () => {
  const purchase = withReceipt("40.00", {refundAmount: 15});
  const plan = computeRefundPlan(purchase, null, true);
  assert.deepEqual(plan,
    {requestedCents: 2500, remainingCents: 2500, isFullRefund: true});
  // ...and a second partial is measured against what is left, not the total
  assert.equal(computeRefundPlan(purchase, 25, true).isFullRefund, true);
  assert.equal(computeRefundPlan(purchase, 10, true).isFullRefund, false);
});

test("refunding more than the remainder is rejected", () => {
  assertHttpsError(
    () => computeRefundPlan(withReceipt("40.00", {refundAmount: 15}), 30, true),
    "invalid-argument",
    "partial above the remaining 25.00"
  );
  assertHttpsError(
    () => computeRefundPlan(withReceipt("40.00"), 40.01, true),
    "invalid-argument",
    "a cent over the full charge"
  );
});

test("zero and negative refund amounts are rejected", () => {
  assertHttpsError(() => computeRefundPlan(withReceipt("40.00"), 0, true),
    "invalid-argument", "zero");
  assertHttpsError(() => computeRefundPlan(withReceipt("40.00"), -5, true),
    "invalid-argument", "negative");
  // Sub-cent amounts round to 0 cents and are rejected the same way.
  assertHttpsError(() => computeRefundPlan(withReceipt("40.00"), 0.004, true),
    "invalid-argument", "sub-cent");
});

test("an already fully-refunded purchase is refused - both routes", () => {
  // route 1: the explicit flag
  assertHttpsError(
    () => computeRefundPlan(withReceipt("40.00", {refunded: true}), null, true),
    "failed-precondition",
    "refunded flag"
  );
  // route 2: refunds already add up to the charge
  assertHttpsError(
    () => computeRefundPlan(
      withReceipt("40.00", {refundAmount: 40}), null, true),
    "failed-precondition",
    "nothing left to refund"
  );
  // ...and over-refunded data (remaining < 0) is refused, not "negative
  // remainder" arithmetic.
  assertHttpsError(
    () => computeRefundPlan(
      withReceipt("40.00", {refundAmount: 55}), null, true),
    "failed-precondition",
    "over-refunded"
  );
});

test("a $0/coupon order can only be marked fully refunded", () => {
  // needsPaypalRefund false = nothing was captured through PayPal.
  const free = {total: 0, discount: 0};
  const plan = computeRefundPlan(free, null, false);
  assert.deepEqual(plan,
    {requestedCents: 0, remainingCents: 0, isFullRefund: true});

  // A partial dollar amount against a $0 charge is an admin mistake.
  assertHttpsError(() => computeRefundPlan(free, 5, false),
    "invalid-argument", "partial against a $0 charge");
});

test("a coupon-discounted order with no PayPal capture refunds in full " +
  "when the amount matches the remainder", () => {
  const purchase = {total: 20, discount: 20}; // charged 0
  assert.equal(computeRefundPlan(purchase, 0, false).isFullRefund, true);
  assertHttpsError(() => computeRefundPlan(purchase, 20, false),
    "invalid-argument", "amount unrelated to the (zero) charge");
});

test("the $0-charge guard does not fire for a genuinely free order", () => {
  // charged === 0 and remaining === 0: the "already fully refunded" guard is
  // deliberately scoped to charged > 0, so a free order can still be marked
  // refunded exactly once.
  assert.doesNotThrow(() => computeRefundPlan({total: 0}, null, false));
});

// ------------------------------------------------- needsPaypalRefundFor
//
// The receipt decides whether PayPal is called. Since 2026-09-03 a
// coupon-covered order's receipt is the coupon CODE (it used to be the
// literal "COUPON"); `total` is the PRE-discount subtotal on a web checkout,
// so it is > 0 on exactly the orders that must NOT reach PayPal.

test("a PayPal order id with a positive total needs a PayPal refund", () => {
  assert.equal(needsPaypalRefundFor({total: 20, receipt: "5AB12345XY678901Z"}),
    true);
  // A paid order that also used a partial coupon: the receipt is still the
  // PayPal id, so money moved and must move back.
  assert.equal(needsPaypalRefundFor({
    total: 20, receipt: "5AB12345XY678901Z", couponCode: "SAVE10",
  }), true);
});

test("a coupon-covered order does not, whichever form its receipt takes",
  () => {
    // Backfilled / new form: receipt IS the code (any casing the row holds).
    assert.equal(needsPaypalRefundFor(
      {total: 20, receipt: "FREE100", couponCode: "FREE100"}), false);
    assert.equal(needsPaypalRefundFor(
      {total: 20, receipt: "free100", couponCode: "FREE100"}), false);
    // Pre-backfill form, still honoured.
    assert.equal(needsPaypalRefundFor(
      {total: 20, receipt: "COUPON", couponCode: "FREE100"}), false);
  });

test("a naturally free or receipt-less order does not", () => {
  assert.equal(needsPaypalRefundFor({total: 0, receipt: "FREE ONLY"}), false);
  assert.equal(needsPaypalRefundFor({total: 20, receipt: "FREE ONLY"}), false);
  assert.equal(needsPaypalRefundFor({total: 20, receipt: ""}), false);
  assert.equal(needsPaypalRefundFor({total: 20}), false);
  assert.equal(needsPaypalRefundFor({total: 0, receipt: "5AB12345XY678901Z"}),
    false);
});
