// The reader Store's per-line coupon discount as the SERVER computes it
// (library-store-pricing.readerLineDiscount) - what a PayPal capture is
// verified against. Pinned: tag scope, and the shared sale-versus-coupon
// rule that verifyAndGrantReaderStorePurchase skipped until 2026-09-05
// (it stacked a coupon on top of a sale price, matching the reader's own
// bug, while the web cart and the store checkout did not).
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {readerLineDiscount, isOnSale, effectivePrice, round2} =
  require("../lib/library-store-pricing");
const shared = require("../lib/common/shared/lists/money");

test("round2 is the shared one", () => {
  assert.equal(round2, shared.round2);
});

test("isOnSale agrees with effectivePrice", () => {
  assert.equal(isOnSale({cost: 20, salePrice: 10}), true);
  assert.equal(effectivePrice({cost: 20, salePrice: 10}), 10);
  assert.equal(isOnSale({cost: 20, salePrice: 0}), false);
  assert.equal(isOnSale({cost: 20, salePrice: 25}), false);
  assert.equal(isOnSale({cost: 20}), false);
});

test("a partial coupon discounts a full-price line to the cent", () => {
  const d = readerLineDiscount("p1", {cost: 9.99}, {percentOff: 33});
  assert.equal(d, 3.3);
});

test("a partial coupon loses to a sale price", () => {
  const d = readerLineDiscount("p1", {cost: 20, salePrice: 10},
    {percentOff: 50});
  assert.equal(d, 0);
});

test("a giveaway beats the sale and takes the SALE price to $0", () => {
  const d = readerLineDiscount("p1", {cost: 20, salePrice: 10},
    {percentOff: 100});
  assert.equal(d, 10);
});

test("a tagged coupon covers only the products it names", () => {
  const coupon = {percentOff: 50, tags: [{id: "p1"}]};
  assert.equal(readerLineDiscount("p1", {cost: 10}, coupon), 5);
  assert.equal(readerLineDiscount("p2", {cost: 10}, coupon), 0);
});

test("no coupon, no discount", () => {
  assert.equal(readerLineDiscount("p1", {cost: 10}, undefined), 0);
});
