// findActiveCoupon: the read + pickActiveCoupon, together. Four money
// paths did the read themselves; the one that mattered most - lookup_coupon,
// which tells the shopper "applied" - did its OWN find with no isActive
// filter, so where a code was duplicated (prod has two SAVE coupons) it
// could report the inactive twin and refuse a code checkout would accept.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {findActiveCoupon} = require("../lib/utils/coupons");

const fakeDb = (docs) => ({
  collection: (path) => {
    assert.equal(path, "tenants/impactdisciples.com/coupons");
    return {
      get: async () => ({
        docs: docs.map(([id, data]) => ({id, data: () => data})),
      }),
    };
  },
});

test("returns the active twin with its document id, case-insensitively",
  async () => {
    const db = fakeDb([
      ["old", {code: "SAVE", isActive: false, percentOff: 10}],
      ["live", {code: "Save", isActive: true, percentOff: 20}],
    ]);
    const found = await findActiveCoupon(db, " save ");
    assert.equal(found.id, "live");
    assert.equal(found.data.percentOff, 20);
  });

test("is undefined for an unknown, inactive or blank code", async () => {
  const db = fakeDb([["old", {code: "SAVE", isActive: false}]]);
  assert.equal(await findActiveCoupon(db, "SAVE"), undefined);
  assert.equal(await findActiveCoupon(db, "NOPE"), undefined);
  assert.equal(await findActiveCoupon(db, ""), undefined);
  assert.equal(await findActiveCoupon(db, undefined), undefined);
});
