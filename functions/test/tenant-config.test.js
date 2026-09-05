// readTenantConfig: the one way the functions read the site's `config`
// singleton. Pinned: a single document comes back as its data, an empty
// collection is undefined (never a throw), and two documents are refused -
// limit(1) picking one at random was how a stray copy could have charged
// against the wrong PayPal app with no error anywhere.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {readTenantConfig} = require("../lib/utils/tenant-config");

const fakeDb = (docs) => ({
  collection: (path) => {
    assert.equal(path, "tenants/impactdisciples.com/config");
    return {
      get: async () => ({
        size: docs.length,
        docs: docs.map(([id, data]) => ({id, data: () => data})),
      }),
    };
  },
});

test("returns the one document's data", async () => {
  const db = fakeDb([["main", {paypalClientId: "a", freeShippingAmount: 50}]]);
  assert.deepEqual(await readTenantConfig(db),
    {paypalClientId: "a", freeShippingAmount: 50});
});

test("resolves undefined for an empty collection", async () => {
  assert.equal(await readTenantConfig(fakeDb([])), undefined);
});

test("refuses to guess between two documents, naming them", async () => {
  const db = fakeDb([["main", {}], ["copy", {}]]);
  await assert.rejects(readTenantConfig(db), /found 2 \(main, copy\)/);
});
