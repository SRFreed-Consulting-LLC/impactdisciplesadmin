// The shared server-side "did the customer actually pay what WE computed"
// check, extracted 2026-08-27 (sweep P5) from two copies that had drifted.
//
// These matter more than most: this is the check the 2026-08-12
// checkout-security work exists to guarantee. Before extraction it was
// implemented twice, and the free-order threshold already disagreed between
// them - `total > 0.005` in library-purchases, `total > 0` in
// library-group-licenses. There was no test on either copy.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {
  FREE_ORDER_EPSILON,
  assertCaptureMatchesTotal,
  isEffectivelyFree,
} = require("../lib/utils/capture-verify");

/** A PayPal capture as getOrderCapture reports it. */
function capture(over = {}) {
  return {
    captureId: "CAP-1",
    status: "COMPLETED",
    amount: 25,
    currencyCode: "USD",
    ...over,
  };
}

test("a COMPLETED capture matching the total passes", () => {
  assertCaptureMatchesTotal(capture(), 25, "the computed total ($25.00)");
});

test("a non-COMPLETED status is refused even with the right amount", () => {
  // A captureId existing is NOT proof money moved - PENDING and DECLINED
  // both carry one.
  for (const status of ["PENDING", "DECLINED", "FAILED", "REFUNDED"]) {
    assert.throws(
      () => assertCaptureMatchesTotal(capture({status}), 25, "the total"),
      /not completed/i,
      `status ${status} must be refused`
    );
  }
});

test("a short payment is refused", () => {
  assert.throws(
    () => assertCaptureMatchesTotal(capture({amount: 0.01}), 25, "the total"),
    /does not match/i
  );
});

test("an overpayment is refused too - it means our math disagrees", () => {
  assert.throws(
    () => assertCaptureMatchesTotal(capture({amount: 250}), 25, "the total"),
    /does not match/i
  );
});

test("a non-USD currency is refused even when the number matches", () => {
  // 25 CAD is not 25 USD. Comparing only the number would accept it.
  assert.throws(
    () => assertCaptureMatchesTotal(
      capture({currencyCode: "CAD"}), 25, "the total"
    ),
    /does not match/i
  );
});

test("cent-level rounding is tolerated, more than that is not", () => {
  // PayPal reports its own string amount; exact equality would reject real
  // payments over float rounding.
  assertCaptureMatchesTotal(capture({amount: 25.009}), 25, "the total");
  assertCaptureMatchesTotal(capture({amount: 24.991}), 25, "the total");
  assert.throws(
    () => assertCaptureMatchesTotal(capture({amount: 24.5}), 25, "the total"),
    /does not match/i
  );
});

test("the caller's description reaches the error message", () => {
  // The one thing the two money paths legitimately differ on.
  assert.throws(
    () => assertCaptureMatchesTotal(
      capture({amount: 1}), 25, "the price for 5 licenses ($25.00)"
    ),
    /the price for 5 licenses/
  );
});

test("isEffectivelyFree: a real charge is never free", () => {
  // A cent is the smallest real charge and must require payment.
  assert.equal(isEffectivelyFree(0.01), false);
  assert.equal(isEffectivelyFree(25), false);
});

test("isEffectivelyFree: zero and float dust are free", () => {
  // The reason the threshold is not `> 0`: round2 can leave sub-cent dust,
  // and rejecting that would fail a genuinely free order.
  assert.equal(isEffectivelyFree(0), true);
  assert.equal(isEffectivelyFree(0.000000001), true);
  assert.equal(isEffectivelyFree(FREE_ORDER_EPSILON), true);
});

test("the two money paths now share ONE free threshold", () => {
  // Pins the drift that made this worth extracting: library-group-licenses
  // used `total > 0` and library-purchases used `total > 0.005`, so the two
  // disagreed about what counts as free.
  assert.equal(FREE_ORDER_EPSILON, 0.005);
});
