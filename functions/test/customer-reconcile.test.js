// The fill-or-flag rule both customer-upsert triggers apply, extracted
// 2026-08-27 (sweep P6) from two independent implementations.
//
// Neither copy had a test. That mattered: this is the write path for the
// "Pending Updates" queue an admin resolves by hand, so the two triggers had
// to agree on the entry shape AND on when a difference is a real
// disagreement versus a fill-in - enforced only by the two copies happening
// to match.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {
  CustomerReconciler,
  addressesDiffer,
} = require("../lib/utils/customer-reconcile");

const ADDR = {
  address1: "1 Test Way", city: "Atlanta", state: "GA", zip: "30301",
};

/** A reconciler over a customer document. */
function on(customer, source = "purchase") {
  return new CustomerReconciler(customer, source, "src-1");
}

test("fills a blank name directly rather than queueing it", () => {
  const r = on({});
  r.name("firstName", "Ada");
  const out = r.result();
  assert.equal(out.directUpdates.firstName, "Ada");
  assert.equal(out.pendingChanges.length, 0);
  assert.equal(out.changed, true);
});

test("leaves an equal name alone - case/spacing are not differences", () => {
  const r = on({firstName: "Ada"});
  r.name("firstName", "  ada  ");
  const out = r.result();
  assert.deepEqual(out.directUpdates, {});
  assert.equal(out.pendingChanges.length, 0);
  assert.equal(out.changed, false);
});

test("QUEUES a genuinely different name instead of overwriting", () => {
  // An unverified checkout form must not silently correct a name on file.
  const r = on({firstName: "Ada"});
  r.name("firstName", "Grace");
  const out = r.result();
  assert.deepEqual(out.directUpdates, {});
  assert.equal(out.pendingChanges.length, 1);
  assert.equal(out.pendingChanges[0].field, "firstName");
  assert.equal(out.pendingChanges[0].currentValue, "Ada");
  assert.equal(out.pendingChanges[0].proposedValue, "Grace");
});

test("an empty or non-string proposal does nothing at all", () => {
  const r = on({firstName: "Ada"});
  r.name("firstName", "   ");
  r.name("lastName", undefined);
  r.name("lastName", 42);
  const out = r.result();
  assert.equal(out.changed, false);
  assert.equal(out.pendingChanges.length, 0);
});

test("JUNK PHONE is ignored, not treated as 'nothing on file'", () => {
  // The live bug this guard exists for: "x" strips to zero digits, which
  // looked identical to an empty field, so a blank phone was "filled" with
  // the same junk on every future purchase - two 2026-08-13 backfill runs
  // never converged because of exactly this.
  const r = on({});
  r.phone({number: "x"});
  const out = r.result();
  assert.deepEqual(out.directUpdates, {});
  assert.equal(out.changed, false);
});

test("phone compares on DIGITS - punctuation is not a difference", () => {
  const r = on({phone: {number: "(678) 854-9322"}});
  r.phone({number: "6788549322"});
  assert.equal(r.result().changed, false);
});

test("a different phone is queued, a blank one filled", () => {
  const fill = on({});
  fill.phone({number: "6788549322"});
  assert.equal(fill.result().directUpdates.phone.number, "6788549322");

  const flag = on({phone: {number: "6788549322"}});
  flag.phone({number: "4045551212"});
  const out = flag.result();
  assert.equal(out.pendingChanges.length, 1);
  assert.equal(out.pendingChanges[0].field, "phone");
});

test("an address with no address1 is not worth proposing", () => {
  const r = on({});
  r.address("shippingAddress", {city: "Atlanta"});
  assert.equal(r.result().changed, false);
});

test("a blank address is filled; a different one is queued", () => {
  const fill = on({});
  fill.address("shippingAddress", ADDR);
  assert.deepEqual(fill.result().directUpdates.shippingAddress, ADDR);

  const flag = on({shippingAddress: ADDR});
  flag.address("shippingAddress", {...ADDR, address1: "2 Other Rd"});
  assert.equal(flag.result().pendingChanges[0].field, "shippingAddress");
});

test("an equal address differing only in case/space is left alone", () => {
  const r = on({shippingAddress: ADDR});
  r.address("shippingAddress", {
    address1: " 1 test way ", city: "ATLANTA", state: "ga", zip: "30301",
  });
  assert.equal(r.result().changed, false);
});

test("re-flagging a field REPLACES its entry, never duplicates", () => {
  // The queue is what an admin works through; two entries for one field
  // would be two decisions about the same thing.
  const r = on({firstName: "Ada"});
  r.name("firstName", "Grace");
  r.name("firstName", "Hopper");
  const out = r.result();
  assert.equal(out.pendingChanges.length, 1);
  assert.equal(out.pendingChanges[0].proposedValue, "Hopper");
});

test("existing queued changes for OTHER fields are preserved", () => {
  const r = on({
    firstName: "Ada",
    pendingChanges: [{field: "phone", currentValue: null, proposedValue: {}}],
  });
  r.name("firstName", "Grace");
  const out = r.result();
  assert.equal(out.pendingChanges.length, 2);
  assert.ok(out.pendingChanges.some((p) => p.field === "phone"));
});

test("the source is stamped from the trigger, not guessed", () => {
  // The two triggers write different sources; the admin queue shows it.
  const cust = {firstName: "Ada"};
  const reg = new CustomerReconciler(cust, "eventRegistration", "e1");
  reg.name("firstName", "Grace");
  const entry = reg.result().pendingChanges[0];
  assert.equal(entry.source, "eventRegistration");
  assert.equal(entry.sourceId, "e1");
});

test("addressesDiffer normalizes case and whitespace per field", () => {
  assert.equal(addressesDiffer(ADDR, {...ADDR}), false);
  assert.equal(addressesDiffer(ADDR, {...ADDR, city: " atlanta "}), false);
  assert.equal(addressesDiffer(ADDR, {...ADDR, zip: "30302"}), true);
  assert.equal(addressesDiffer(null, null), false);
});
