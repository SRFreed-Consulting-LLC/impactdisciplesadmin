// Input-validation tests for computeOrderPricing
// (utils/checkout-pricing.functions.ts) - the server-side recompute behind
// create_paypal_order and capture_paypal_order.
//
// Why this suite matters: these guards are the reason a hostile client
// cannot buy something for nothing. The file's own comment on the quantity
// check spells out the exploit it closes - a negative orderQuantity makes
// the subtotal negative, which collapses the total to exactly 0, which
// skips PayPal entirely (create_paypal_order's `pricing.total <= 0` branch)
// and writes a real, verified-looking Purchase record for a real product
// with no payment at all. That is free merchandise, and until now nothing
// tested it.
//
// These assertions need no Firestore and no emulator: every check under
// test runs BEFORE the function reaches `getFirestore()`, which is what
// makes them cheap to pin and worth pinning.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {computeOrderPricing} =
  require("../lib/utils/checkout-pricing.functions");

/** A structurally valid request; individual tests corrupt one field. */
function request(overrides = {}) {
  return {
    cartItems: [{id: "prod-1", orderQuantity: 1}],
    shippingAddress: {state: "GA", zip: "30096"},
    shippingRate: 8.5,
    ...overrides,
  };
}

/** Asserts the call rejects before any Firestore access. */
async function assertRejects(req, expected, label) {
  await assert.rejects(
    () => computeOrderPricing(req),
    (err) => {
      assert.match(
        err.message, expected, `${label}: ${err.message}`);
      return true;
    },
    label
  );
}

// ------------------------------------------------------- order quantity

test("a negative quantity is rejected", async () => {
  // The headline exploit: negative quantity -> negative subtotal -> total
  // collapses to 0 -> PayPal is skipped -> a real Purchase is written for
  // real goods with no payment.
  await assertRejects(
    request({cartItems: [{id: "prod-1", orderQuantity: -1}]}),
    /Invalid orderQuantity for item prod-1/,
    "negative quantity"
  );
});

test("a zero quantity is rejected", async () => {
  await assertRejects(
    request({cartItems: [{id: "prod-1", orderQuantity: 0}]}),
    /Invalid orderQuantity/,
    "zero quantity"
  );
});

test("a fractional quantity is rejected", async () => {
  // 0.5 of a book is not a thing, and fractional quantities are a route to
  // fractional-cent rounding games.
  await assertRejects(
    request({cartItems: [{id: "prod-1", orderQuantity: 1.5}]}),
    /Invalid orderQuantity/,
    "fractional quantity"
  );
});

test("a non-numeric quantity is rejected", async () => {
  // A JSON body can carry anything; "1" must not be coerced into 1.
  for (const bad of ["1", null, undefined, {}, [], true, NaN]) {
    await assertRejects(
      request({cartItems: [{id: "prod-1", orderQuantity: bad}]}),
      /Invalid orderQuantity/,
      `quantity ${JSON.stringify(bad)}`
    );
  }
});

test("an absurd quantity is rejected at the sanity cap", async () => {
  // 1000 is a generous cap, not a business limit - large enough for any
  // plausible bulk order, small enough to reject clearly abusive input.
  await assertRejects(
    request({cartItems: [{id: "prod-1", orderQuantity: 1001}]}),
    /Invalid orderQuantity/,
    "over the cap"
  );
  await assertRejects(
    request({
      cartItems: [{id: "prod-1", orderQuantity: Number.MAX_SAFE_INTEGER}],
    }),
    /Invalid orderQuantity/,
    "max safe integer"
  );
});

test("the guard names the offending item, not just the request", async () => {
  // A cart with several items has to say WHICH one failed, or the error is
  // useless in a support conversation.
  await assertRejects(
    request({
      cartItems: [
        {id: "good-1", orderQuantity: 2},
        {id: "bad-item", orderQuantity: -5},
      ],
    }),
    /Invalid orderQuantity for item bad-item/,
    "names the item"
  );
});

// -------------------------------------------------------- shipping rate

test("a negative shipping rate is rejected", async () => {
  // Same class as the quantity exploit: an unvalidated negative rate pulls
  // the total below the real cost of the goods.
  await assertRejects(
    request({shippingRate: -10}), /Invalid shippingRate/, "negative");
});

test("a non-numeric or non-finite shipping rate is rejected", async () => {
  for (const bad of ["8.50", null, undefined, NaN, Infinity, -Infinity, {}]) {
    await assertRejects(
      request({shippingRate: bad}),
      /Invalid shippingRate/,
      `shippingRate ${String(bad)}`
    );
  }
});

test("a zero shipping rate is allowed", async () => {
  // Free shipping and digital-only carts are legitimate, so zero must NOT
  // be rejected. It gets past the guards and fails later reaching
  // Firestore, which is exactly how we know it passed validation.
  await assert.rejects(
    () => computeOrderPricing(request({shippingRate: 0})),
    (err) => {
      assert.doesNotMatch(err.message, /Invalid shippingRate/,
        "zero shipping rate must survive validation");
      return true;
    }
  );
});

// ------------------------------------------------------------- ordering

test("quantity is validated before any product data is fetched", async () => {
  // The check has to come first: pricing a hostile cart at all, even to
  // throw later, means paying for the Firestore reads. An empty product id
  // would fail a document lookup if we ever got that far - the quantity
  // error proves we did not.
  await assertRejects(
    request({cartItems: [{id: "", orderQuantity: -1}]}),
    /Invalid orderQuantity/,
    "quantity checked before lookup"
  );
});
