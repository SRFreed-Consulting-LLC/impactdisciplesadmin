// Unit tests for hasPhysicalItem - the single definition of "does this
// purchase ship anything", shared by fulfillment and customer upsert.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {hasPhysicalItem} = require("../lib/utils/cart-items.functions");

test("a plain item (no flags) is physical", () => {
  assert.equal(hasPhysicalItem([{}]), true);
});

test("ebooks, digital books, and event registrations are not physical", () => {
  assert.equal(hasPhysicalItem([{isEBook: true}]), false);
  assert.equal(hasPhysicalItem([{isDigitalBook: true}]), false);
  assert.equal(hasPhysicalItem([{isEvent: true}]), false);
  assert.equal(hasPhysicalItem([
    {isEBook: true}, {isDigitalBook: true}, {isEvent: true},
  ]), false);
});

test("one physical item among digital ones flips the whole cart", () => {
  assert.equal(hasPhysicalItem([{isEBook: true}, {}, {isEvent: true}]), true);
});

test("empty or missing cart is not physical", () => {
  assert.equal(hasPhysicalItem([]), false);
  assert.equal(hasPhysicalItem(undefined), false);
  assert.equal(hasPhysicalItem(null), false);
});
