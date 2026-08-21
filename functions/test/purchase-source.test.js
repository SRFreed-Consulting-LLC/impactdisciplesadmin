// Unit tests for the purchases discriminator (2026-08-21, bucket C item 1).
//
// This decides WHICH PAYPAL APP a refund is issued against - the web
// storefront and the reader store are two different PayPal apps with
// different credentials - so every branch is pinned, including the legacy
// fallback that must keep working until historic docs are backfilled.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {purchaseSourceOf} = require("../lib/purchase-source");

test("an explicit source wins", () => {
  assert.equal(purchaseSourceOf({source: "web"}), "web");
  assert.equal(purchaseSourceOf({source: "reader"}), "reader");
});

test("explicit source beats the legacy inference, both ways", () => {
  // The whole point: a web doc that somehow carries paypalEnvironment must
  // NOT be refunded against the reader PayPal app once it says so itself.
  assert.equal(
    purchaseSourceOf({source: "web", paypalEnvironment: "live"}), "web");
  assert.equal(
    purchaseSourceOf({source: "reader", paypalEnvironment: undefined}),
    "reader");
});

test("legacy docs fall back to the paypalEnvironment inference", () => {
  // Reader-store purchases stamp paypalEnvironment when they go through
  // PayPal; web-storefront purchases never write the field at all.
  assert.equal(purchaseSourceOf({paypalEnvironment: "live"}), "reader");
  assert.equal(purchaseSourceOf({paypalEnvironment: "sandbox"}), "reader");
  assert.equal(purchaseSourceOf({}), "web");
});

test("a free legacy reader purchase reads as web - and that is safe", () => {
  // paypalEnvironment is only stamped when a PayPal order exists, so a
  // free/coupon reader purchase has never carried it. It classifies as
  // "web", which is harmless: the refund path only consults the source
  // inside `if (needsPaypalRefund)`, and that requires total > 0 with a
  // real receipt, so a free purchase never reaches the branch at all.
  // Pinned so the reasoning survives, and so backfilling these to "reader"
  // is understood as a correction rather than a behaviour change.
  assert.equal(purchaseSourceOf({total: 0, receipt: "FREE ONLY"}), "web");
});

test("a non-string or unrecognised source is ignored, not trusted", () => {
  assert.equal(purchaseSourceOf({source: 123}), "web");
  assert.equal(purchaseSourceOf({source: "READER"}), "web");
  assert.equal(
    purchaseSourceOf({source: null, paypalEnvironment: "live"}), "reader");
  assert.equal(purchaseSourceOf({source: ""}), "web");
});

test("a non-string paypalEnvironment does not imply reader", () => {
  assert.equal(purchaseSourceOf({paypalEnvironment: 1}), "web");
  assert.equal(purchaseSourceOf({paypalEnvironment: null}), "web");
});
