// Unit tests for the server-authoritative pricing of a group leader's bulk
// license purchase (purchaseGroupLicenses): the tier lookup + the money
// math a PayPal capture is verified against. Runs against ../lib via
// `npm test` - no emulator, no Firebase app.
//
// Why it matters: this total is the ONLY thing standing between a real
// payment and 1000 minted licenses (see the "SERVER-AUTHORITATIVE PRICING"
// comment in library-group-licenses.functions.ts - a 2026-08-17 sweep fixed
// a version that trusted the client's own total, so $0.01 could buy the
// lot). The capture check allows a 1-cent tolerance, so every figure here
// is asserted to the cent.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {computeGroupLicensePricing, effectivePrice, round2} =
  require("../lib/library-store-pricing");
const {resolveBulkDiscountPercent} =
  require("../lib/common/models/bulk-discount.util");

const TIERS = [
  {numberOfBooks: 5, percentOff: 10},
  {numberOfBooks: 10, percentOff: 20},
  {numberOfBooks: 25, percentOff: 30},
];

// ------------------------------------------------- tier resolution

test("the tier lookup picks the highest tier at or below the quantity", () => {
  assert.equal(resolveBulkDiscountPercent(TIERS, 4), 0);
  assert.equal(resolveBulkDiscountPercent(TIERS, 5), 10);
  assert.equal(resolveBulkDiscountPercent(TIERS, 7), 10);
  assert.equal(resolveBulkDiscountPercent(TIERS, 10), 20);
  assert.equal(resolveBulkDiscountPercent(TIERS, 24), 20);
  assert.equal(resolveBulkDiscountPercent(TIERS, 1000), 30);
});

test("the tier lookup is order-independent and handles an empty table", () => {
  const shuffled = [TIERS[2], TIERS[0], TIERS[1]];
  assert.equal(resolveBulkDiscountPercent(shuffled, 12), 20);
  assert.equal(resolveBulkDiscountPercent([], 50), 0);
});

test("a malformed tier row degrades to no discount at the call site", () => {
  // The handler applies `?? 0` for exactly this case - a row whose
  // percentOff was never set must not make the total NaN.
  const bad = [{numberOfBooks: 5}];
  const percent = resolveBulkDiscountPercent(bad, 10) ?? 0;
  assert.equal(percent, 0);
  assert.equal(computeGroupLicensePricing(10, 10, percent).total, 100);
});

// ------------------------------------------------- pricing math

test("no discount: total is unit price x quantity", () => {
  assert.deepEqual(computeGroupLicensePricing(12.5, 4, 0), {
    subtotal: 50,
    discount: 0,
    total: 50,
    unitDiscountPrice: 12.5,
  });
});

test("a tier discount is applied to the subtotal, not per unit", () => {
  // 10 x $12.50 = $125.00, 20% off = $25.00 -> $100.00 ($10.00/license)
  assert.deepEqual(computeGroupLicensePricing(12.5, 10, 20), {
    subtotal: 125,
    discount: 25,
    total: 100,
    unitDiscountPrice: 10,
  });
});

test("every figure is rounded to whole cents", () => {
  // 3 x $9.99 = $29.97, 10% off = $2.997 -> $3.00, total $26.97,
  // per-license $8.99.
  assert.deepEqual(computeGroupLicensePricing(9.99, 3, 10), {
    subtotal: 29.97,
    discount: 3,
    total: 26.97,
    unitDiscountPrice: 8.99,
  });
});

test("a per-license price that does not divide evenly still rounds", () => {
  const pricing = computeGroupLicensePricing(10, 3, 10);
  assert.equal(pricing.subtotal, 30);
  assert.equal(pricing.discount, 3);
  assert.equal(pricing.total, 27);
  assert.equal(pricing.unitDiscountPrice, 9);

  // 7 licenses at $10 with 10% off = $63.00 -> $9.00 each exactly;
  // 6 at $10.05 with 10% off = $60.30 -> $10.05 each.
  assert.equal(computeGroupLicensePricing(10.05, 6, 10).total, 54.27);
  assert.equal(
    computeGroupLicensePricing(10.05, 6, 10).unitDiscountPrice, 9.05);
});

test("a free product prices to zero without dividing by zero", () => {
  assert.deepEqual(computeGroupLicensePricing(0, 5, 20), {
    subtotal: 0,
    discount: 0,
    total: 0,
    unitDiscountPrice: 0,
  });
});

test("a zero quantity cannot produce a NaN per-license price", () => {
  // The handler rejects quantity < 1 before pricing, but the helper must
  // not emit NaN if that guard ever moves.
  assert.equal(computeGroupLicensePricing(10, 0, 0).unitDiscountPrice, 0);
});

test("100% off zeroes the total", () => {
  assert.deepEqual(computeGroupLicensePricing(20, 5, 100), {
    subtotal: 100,
    discount: 100,
    total: 0,
    unitDiscountPrice: 0,
  });
});

// ---------------------------------- unit price feeding the pricing

test("effectivePrice only honours a sale price below cost", () => {
  assert.equal(effectivePrice({cost: 20, salePrice: 15}), 15);
  assert.equal(effectivePrice({cost: 20, salePrice: 25}), 20); // above cost
  assert.equal(effectivePrice({cost: 20, salePrice: 0}), 20);
  assert.equal(effectivePrice({cost: 20}), 20);
  assert.equal(effectivePrice({}), 0);
});

test("end to end: a sale-priced book at a discount tier", () => {
  const unitPrice = effectivePrice({cost: 24.99, salePrice: 19.99});
  const percent = resolveBulkDiscountPercent(TIERS, 10);
  const pricing = computeGroupLicensePricing(unitPrice, 10, percent);
  assert.equal(unitPrice, 19.99);
  assert.equal(percent, 20);
  assert.equal(pricing.subtotal, 199.9);
  assert.equal(pricing.discount, 39.98);
  assert.equal(pricing.total, 159.92);
  assert.equal(pricing.unitDiscountPrice, 15.99);
  // ...and the capture check's cent tolerance is satisfied by an exact match
  assert.ok(Math.abs(round2(pricing.total) - 159.92) <= 0.01);
});

// ------------------------------- coupon vs bulk (2026-08-26)

const {chooseLicenseDiscount} =
  require("../lib/common/models/bulk-discount.util");

// A leader can now enter a coupon on a bulk purchase. The two discounts are
// EXCLUSIVE and the better one wins, so the figure the PayPal capture is
// checked against is whichever of them the server picked - the same rule the
// dialog previews with. Getting this wrong either overcharges a leader who
// had a better code, or hands out a bigger discount than either deal.

test("the better of bulk and coupon is what gets charged", () => {
  const unitPrice = 10;
  const quantity = 10; // 20% bulk tier

  // Coupon beats bulk: 25% off 100.00 = 75.00
  const couponWins = chooseLicenseDiscount(
    resolveBulkDiscountPercent(TIERS, quantity),
    25
  );
  assert.equal(couponWins.source, "coupon");
  assert.equal(
    computeGroupLicensePricing(unitPrice, quantity, couponWins.percentOff)
      .total,
    75
  );

  // Bulk beats coupon: 20% off 100.00 = 80.00, coupon ignored.
  const bulkWins = chooseLicenseDiscount(
    resolveBulkDiscountPercent(TIERS, quantity),
    5
  );
  assert.equal(bulkWins.source, "bulk");
  assert.equal(bulkWins.bulkBeatsCoupon, true);
  assert.equal(
    computeGroupLicensePricing(unitPrice, quantity, bulkWins.percentOff).total,
    80
  );
});

test("bulk and coupon never stack", () => {
  // 20% + 15% would be 35% (65.00). It must stay the better single one.
  const choice = chooseLicenseDiscount(20, 15);
  assert.equal(choice.percentOff, 20);
  assert.equal(computeGroupLicensePricing(10, 10, choice.percentOff).total, 80);
});

test("an inapplicable coupon is not reported as beaten by bulk", () => {
  // null = no coupon, or one whose tags do not cover this book. Telling the
  // leader "your bulk deal beat that code" would be a message about a coupon
  // that was never in the running.
  assert.equal(chooseLicenseDiscount(20, null).bulkBeatsCoupon, false);
  assert.equal(chooseLicenseDiscount(20, 0).bulkBeatsCoupon, true);
});

test("a 100% coupon prices to exactly zero, not a negative total", () => {
  const choice = chooseLicenseDiscount(
    resolveBulkDiscountPercent(TIERS, 3),
    100
  );
  assert.equal(choice.source, "coupon");
  const {total, discount} =
    computeGroupLicensePricing(10, 3, choice.percentOff);
  assert.equal(total, 0);
  assert.equal(discount, 30);
});

test("a malformed coupon percentage cannot pay the buyer", () => {
  // The function refuses a non-numeric percentOff by treating it as 0, and
  // anything over 100 clamps - either way the total stays >= 0.
  assert.equal(chooseLicenseDiscount(0, 150).percentOff, 100);
  assert.equal(chooseLicenseDiscount(0, -50).percentOff, 0);
  const clampedHigh = chooseLicenseDiscount(0, 150).percentOff;
  const clampedLow = chooseLicenseDiscount(0, -50).percentOff;
  assert.equal(computeGroupLicensePricing(10, 5, clampedHigh).total, 0);
  assert.equal(computeGroupLicensePricing(10, 5, clampedLow).total, 50);
});
