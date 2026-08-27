// Unit tests for findOrCreateCustomer (utils/customer-match.functions.ts).
//
// The behaviour under test is atomicity, so the fake below models the two
// things that actually matter about a Firestore transaction: reads see the
// committed store, and a retried attempt discards whatever the previous
// attempt staged. Prod runs PESSIMISTIC concurrency, so a second racer
// blocks and then re-reads - which is the sequential case here.
//
// Runs against ../lib via `npm test`.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {findOrCreateCustomer} =
  require("../lib/utils/customer-match.functions");

/**
 * Minimal Firestore stand-in supporting exactly what the helper uses.
 * @param {Array<object>} initial Pre-existing customer documents.
 * @param {number} attempts How many times runTransaction runs its body;
 *   only the last attempt commits, mirroring a real retry.
 * @return {object} The fake db, with __store exposed for assertions.
 */
function makeDb(initial = [], attempts = 1) {
  const store = new Map(initial.map((d, i) => [`seed${i}`, {...d}]));
  let autoId = 0;

  const makeRef = (id) => ({
    id,
    update: async (patch) => store.set(id, {...store.get(id), ...patch}),
  });

  const runQuery = (q) => {
    const hits = [...store.entries()]
      .filter(([, d]) => d[q.field] === q.value)
      .map(([id, d]) => ({ref: makeRef(id), data: () => ({...d})}));
    return {empty: hits.length === 0, docs: hits};
  };

  return {
    __store: store,
    collection: () => ({
      where: (field, op, value) => ({limit: () => ({field, op, value})}),
      doc: () => makeRef(`new${++autoId}`),
    }),
    runTransaction: async (body) => {
      let result;
      for (let i = 0; i < attempts; i++) {
        const staged = [];
        result = await body({
          get: async (q) => runQuery(q),
          create: (ref, data) => staged.push([ref.id, data]),
        });
        if (i === attempts - 1) {
          staged.forEach(([id, data]) => store.set(id, data));
        }
      }
      return result;
    },
  };
}

test("creates a customer when the email is not present", async () => {
  const db = makeDb();

  const result = await findOrCreateCustomer(db, "new@example.com", {
    firstName: "Ada",
    lastName: "Lovelace",
  });

  assert.equal(result.created, true);
  assert.equal(result.data.email, "new@example.com");
  assert.equal(result.data.firstName, "Ada");
  assert.equal(db.__store.size, 1);
});

test("seeds the shared shape so both triggers create alike", () => {
  // A customer created by the registration trigger and one created by the
  // purchase trigger must not differ in shape - the update path assumes
  // pendingChanges/notes/tags are arrays and role is set.
  return findOrCreateCustomer(makeDb(), "a@b.com", {}).then((r) => {
    assert.equal(r.data.role, "Customer");
    assert.deepEqual(r.data.notes, []);
    assert.deepEqual(r.data.pendingChanges, []);
    assert.deepEqual(r.data.tags, []);
  });
});

test("returns the existing customer and ignores the seed", async () => {
  const db = makeDb([
    {email: "her@example.com", firstName: "Grace", role: "Customer"},
  ]);

  const result = await findOrCreateCustomer(db, "her@example.com", {
    firstName: "SHOULD NOT OVERWRITE",
  });

  assert.equal(result.created, false);
  assert.equal(result.data.firstName, "Grace");
  assert.equal(db.__store.size, 1);
});

test("a second caller for the same email does NOT create a duplicate",
  async () => {
    // The 2026-08-27 prod duplicate: two triggers for one new address,
    // 183ms apart, both saw an empty result and both created.
    const db = makeDb();

    const first = await findOrCreateCustomer(db, "race@example.com", {
      firstName: "First",
    });
    const second = await findOrCreateCustomer(db, "race@example.com", {
      firstName: "Second",
    });

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.ref.id, first.ref.id);
    assert.equal(second.data.firstName, "First");
    assert.equal(db.__store.size, 1);
  });

test("a retried transaction still creates exactly one customer", async () => {
  // Firestore re-runs the body on contention. The body must therefore be
  // pure - a discarded attempt must leave nothing behind.
  const db = makeDb([], 3);

  const result = await findOrCreateCustomer(db, "retry@example.com", {
    firstName: "Ada",
  });

  assert.equal(result.created, true);
  assert.equal(db.__store.size, 1);
});

test("email is always the normalized one, never a seed override", async () => {
  const db = makeDb();

  const result = await findOrCreateCustomer(db, "canonical@example.com", {
    email: "IMPOSTER@example.com",
    role: "Root",
  });

  assert.equal(result.data.email, "canonical@example.com");
  assert.equal(result.data.role, "Customer");
});
