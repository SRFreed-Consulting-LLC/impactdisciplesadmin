const {tenantPath} = require("../scripts/lib/tenancy");
// Integration: the two customer auto-upsert triggers, through the REAL
// Cloud Functions in the emulator - onPurchaseCustomerUpsert
// (customer-upsert.functions.ts, onCreate purchases/{id}) and
// onEventRegistrationCustomerUpsert
// (event-registration-customer-upsert.functions.ts, onCreate
// event-registrations/{id}).
// Charter area: Contacts (customers fed automatically from purchases and
// registrations - never hand-entered).
const {test, before} = require("node:test");
const assert = require("node:assert/strict");
const {getDb, preflight, reseed, waitFor} = require("./helpers/emulator");

let db;

const customerByEmail = async (email) => {
  const snap = await db.collection(tenantPath("customers"))
    .where("email", "==", email).get();
  return snap.empty ?
    null :
    {id: snap.docs[0].id, ...snap.docs[0].data()};
};

before(async () => {
  await preflight();
  reseed();
  db = getDb();
});

test("a purchase with a brand-new email seeds a full customer record " +
  "(names, phone, both addresses)", async () => {
  const shipping = {
    address1: "1 Elm St", address2: "", city: "Newnan",
    state: "GA", zip: "30263", country: "US",
  };
  const billing = {
    address1: "2 Oak St", address2: "", city: "Sharpsburg",
    state: "GA", zip: "30277", country: "US",
  };
  await db.collection(tenantPath("purchases")).add({
    // Mixed case on purpose - the trigger lowercases before matching.
    email: "Ursula-New@Upserts.TEST",
    firstName: "Ursula",
    lastName: "Original",
    phone: {countryCode: "1", number: "(678) 223-5312"},
    shippingAddress: shipping,
    billingAddress: billing,
    isShippingSameAsBilling: false,
    // No isEBook/isDigitalBook/isEvent flags = a physical item, so the
    // addresses are meaningful and get seeded (hasPhysicalItem).
    cartItems: [{id: "prod-book-physical", orderQuantity: 1}],
    dateProcessed: new Date(),
  });

  const customer = await waitFor(
    () => customerByEmail("ursula-new@upserts.test"),
    {timeoutMs: 60000, intervalMs: 1000, label: "customer created from purchase"}
  );
  assert.equal(customer.firstName, "Ursula");
  assert.equal(customer.lastName, "Original");
  assert.equal(customer.email, "ursula-new@upserts.test"); // lowercased
  assert.equal(customer.phone.number, "(678) 223-5312");
  assert.equal(customer.shippingAddress.address1, "1 Elm St");
  assert.equal(customer.billingAddress.address1, "2 Oak St");
  assert.equal(customer.role, "Customer");
  assert.deepEqual(customer.pendingChanges, []);
  assert.deepEqual(customer.tags, []);
});

test("isShippingSameAsBilling seeds the billing address from shipping",
  async () => {
    const shipping = {
      address1: "9 Mirror Rd", city: "Macon",
      state: "GA", zip: "31201", country: "US",
    };
    await db.collection(tenantPath("purchases")).add({
      email: "same-as@upserts.test",
      firstName: "Sam", lastName: "Same",
      shippingAddress: shipping,
      isShippingSameAsBilling: true,
      cartItems: [{id: "prod-shirt", orderQuantity: 1}],
      dateProcessed: new Date(),
    });
    const customer = await waitFor(
      () => customerByEmail("same-as@upserts.test"),
      {timeoutMs: 60000, intervalMs: 1000, label: "same-as-billing customer"}
    );
    assert.equal(customer.shippingAddress.address1, "9 Mirror Rd");
    assert.equal(customer.billingAddress.address1, "9 Mirror Rd");
  });

test("a second purchase with a genuinely different lastName queues a " +
  "pendingChanges entry instead of overwriting - while normalized-equal " +
  "name/phone/address values are NOT flagged", async () => {
  const secondRef = await db.collection(tenantPath("purchases")).add({
    email: "ursula-new@upserts.test",
    // Normalized-same as "Ursula" (case + whitespace) - must NOT flag.
    firstName: "  URSULA ",
    // Genuinely different - must flag, not overwrite.
    lastName: "Changed",
    // Same 10 digits as on file, different formatting + country code -
    // must NOT flag (normalizedPhoneDigits).
    phone: {countryCode: "1", number: "1-678-223-5312"},
    // Same address, city lowercased - must NOT flag (addressesDiffer
    // normalizes field-by-field).
    shippingAddress: {
      address1: "1 Elm St", address2: "", city: "newnan",
      state: "GA", zip: "30263", country: "US",
    },
    isShippingSameAsBilling: false,
    cartItems: [{id: "prod-book-physical", orderQuantity: 1}],
    dateProcessed: new Date(),
  });

  const customer = await waitFor(async () => {
    const c = await customerByEmail("ursula-new@upserts.test");
    return c?.pendingChanges?.length === 1 ? c : null;
  }, {timeoutMs: 60000, intervalMs: 1000, label: "lastName pendingChanges entry"});

  const entry = customer.pendingChanges[0];
  assert.equal(entry.field, "lastName");
  assert.equal(entry.currentValue, "Original");
  assert.equal(entry.proposedValue, "Changed");
  assert.equal(entry.source, "purchase");
  assert.equal(entry.sourceId, secondRef.id);
  assert.ok(entry.detectedDate);
  // The on-file values are untouched - flagged, not silently corrected.
  assert.equal(customer.lastName, "Original");
  assert.equal(customer.firstName, "Ursula");
  assert.equal(customer.phone.number, "(678) 223-5312");
});

test("a third conflicting purchase REPLACES the pending entry for that " +
  "field rather than accumulating duplicates", async () => {
  await db.collection(tenantPath("purchases")).add({
    email: "ursula-new@upserts.test",
    firstName: "Ursula",
    lastName: "Third",
    cartItems: [{id: "prod-book-physical", orderQuantity: 1}],
    dateProcessed: new Date(),
  });
  const customer = await waitFor(async () => {
    const c = await customerByEmail("ursula-new@upserts.test");
    return c?.pendingChanges?.[0]?.proposedValue === "Third" ? c : null;
  }, {timeoutMs: 60000, intervalMs: 1000, label: "pending entry replaced"});
  assert.equal(customer.pendingChanges.length, 1); // replaced, not appended
  assert.equal(customer.pendingChanges[0].field, "lastName");
});

test("an implausible email ('x') creates NO customer record", async () => {
  await db.collection(tenantPath("purchases")).add({
    email: "x",
    firstName: "Bogus", lastName: "Data",
    cartItems: [{id: "prod-book-physical", orderQuantity: 1}],
    dateProcessed: new Date(),
  });
  // Sentinel purchase created AFTER the junk one: once ITS customer
  // exists the trigger queue has drained past the junk purchase, so the
  // negative assertion below isn't just "didn't wait long enough".
  await db.collection(tenantPath("purchases")).add({
    email: "sentinel@upserts.test",
    firstName: "Sen", lastName: "Tinel",
    cartItems: [{id: "prod-shirt", orderQuantity: 1}],
    dateProcessed: new Date(),
  });
  await waitFor(() => customerByEmail("sentinel@upserts.test"),
    {timeoutMs: 60000, intervalMs: 1000, label: "sentinel customer"});

  assert.equal(await customerByEmail("x"), null);
});

test("an event registration creates a names-only customer (no phone, no " +
  "addresses - registrations never carry them)", async () => {
  await db.collection(tenantPath("event-registrations")).add({
    firstName: "Rina",
    lastName: "Registrant",
    lastNameLower: "registrant",
    email: "Rina-New@Upserts.TEST",
    eventId: "event-summit-2027",
    registrationDate: new Date(),
    trainingSessions: [],
  });
  const customer = await waitFor(
    () => customerByEmail("rina-new@upserts.test"),
    {timeoutMs: 60000, intervalMs: 1000, label: "customer from registration"}
  );
  assert.equal(customer.firstName, "Rina");
  assert.equal(customer.lastName, "Registrant");
  assert.equal(customer.role, "Customer");
  assert.deepEqual(customer.pendingChanges, []);
  assert.ok(!("phone" in customer), "registration must not seed phone");
  assert.ok(!("shippingAddress" in customer),
    "registration must not seed shippingAddress");
  assert.ok(!("billingAddress" in customer),
    "registration must not seed billingAddress");
});

test("a conflicting registration for an existing customer queues a " +
  "pendingChanges entry with source eventRegistration", async () => {
  const regRef = await db.collection(tenantPath("event-registrations")).add({
    firstName: "Rina",
    lastName: "Married",
    lastNameLower: "married",
    email: "rina-new@upserts.test",
    eventId: "event-summit-2027",
    registrationDate: new Date(),
    trainingSessions: [],
  });
  const customer = await waitFor(async () => {
    const c = await customerByEmail("rina-new@upserts.test");
    return c?.pendingChanges?.length === 1 ? c : null;
  }, {timeoutMs: 60000, intervalMs: 1000,
    label: "registration pendingChanges entry"});
  const entry = customer.pendingChanges[0];
  assert.equal(entry.field, "lastName");
  assert.equal(entry.proposedValue, "Married");
  assert.equal(entry.source, "eventRegistration");
  assert.equal(entry.sourceId, regRef.id);
  assert.equal(customer.lastName, "Registrant"); // not overwritten
});
