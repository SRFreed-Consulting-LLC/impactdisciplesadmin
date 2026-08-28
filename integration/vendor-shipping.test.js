// Integration: the two ShipEngine-backed Cloud Functions
// (functions/src/shipping.functions.ts) in the emulator, with ShipEngine
// standing in as scripts/fake-vendors.js.
//
// WHY THIS FILE EXISTS
// get_shipping_label had NO test of any kind, and could not have had one:
// buying a label spends real postage, so a passing test would have cost
// money every run. That is a bad reason for an endpoint that moves money and
// is gated by staff auth to be the least-checked thing in the file. Pointing
// the SDK at a fake makes both endpoints testable, and the staff gate -
// which is the actual security control here - can finally be proven rather
// than assumed.
//
// get_shipping_rates is deliberately PUBLIC (anonymous shoppers need a quote
// at checkout); get_shipping_label is staff-only. The tests below pin that
// asymmetry, because getting it backwards in either direction is a real bug:
// a gated rate lookup breaks checkout for everyone, and an open label
// endpoint lets anyone spend the org's postage balance.
const {test, before, beforeEach} = require("node:test");
const assert = require("node:assert/strict");
const {
  preflight, reseed, callHttp, signIn, getDb,
  fakeVendors, preflightFakeVendors,
} = require("./helpers/emulator");

// A rate request shaped the way impactdisciples-web's ShippingService builds
// one (createRequest() -> ShippingRequest: shipment + rateOptions), since
// that is the only real caller. The SDK reshapes this into ShipEngine's
// snake_case wire format itself.
const rateRequest = (weightOunces) => ({
  shipment: {
    shipTo: {
      name: "Pat Buyer",
      phone: "555-0101",
      addressLine1: "1 Peachtree St",
      cityLocality: "Atlanta",
      stateProvince: "GA",
      postalCode: "30301",
      countryCode: "US",
      addressResidentialIndicator: "yes",
    },
    shipFrom: {
      name: "Impact Disciples",
      phone: "555-0100",
      addressLine1: "1 Test Way",
      cityLocality: "Atlanta",
      stateProvince: "GA",
      postalCode: "30301",
      countryCode: "US",
    },
    packages: [{weight: {value: weightOunces, unit: "ounce"}}],
  },
  rateOptions: {carrierIds: ["se-fake-carrier"]},
});

let staffToken;

before(async () => {
  await preflight();
  await preflightFakeVendors();
  reseed();
  // admin@test.local is a seeded Auth user AND has an admin_users record,
  // which is what requireStaffAuth checks - both halves matter.
  staffToken = await signIn("admin@test.local");
});

beforeEach(async () => {
  await fakeVendors.reset();
});

// ---------------------------------------------------------------------------
// Rates - public
// ---------------------------------------------------------------------------

test("get_shipping_rates returns the carrier's rates to an ANONYMOUS caller",
  async () => {
    // No Authorization header at all. This endpoint must stay open: a
    // shopper is not signed in and cannot see a total without it.
    const res = await callHttp("get_shipping_rates", rateRequest(16));

    assert.equal(res.status, 200, JSON.stringify(res.body));
    const rates = res.body.rateResponse.rates;
    assert.equal(rates.length, 2);
    // The web client sorts ascending and takes [0]; the fake answers
    // deliberately UNSORTED so that sort is doing real work.
    const amounts = rates.map((r) => Number(r.shippingAmount.amount));
    assert.deepEqual(amounts, [21.42, 9.42]);
    assert.equal(Math.min(...amounts), 9.42);
  });

test("the package weight the client computed is what reaches the carrier",
  async () => {
    // Weight is summed client-side from cart items. If it does not survive
    // the trip, every quote is wrong and nothing downstream would notice -
    // the shopper just sees a plausible number.
    await callHttp("get_shipping_rates", rateRequest(48));
    const [call] = await fakeVendors.log("shipengine");
    assert.equal(call.op, "rates");
    assert.equal(call.weight, 48);
    assert.equal(call.packages, 1);
  });

test("an unusable rate VALUE still answers 200 - the vendor did not fail",
  async () => {
    // Not a vendor failure: ShipEngine answers normally, the number is
    // just junk. The handler's success path runs, so this stays 200.
    // (Renamed 2026-08-28 - it used to be called a "carrier failure",
    // which it never was; the real failure branch is the test below.)
    await fakeVendors.control({shippingRate: "not-a-number"});
    const res = await callHttp("get_shipping_rates", rateRequest(16));
    assert.equal(res.status, 200);
    // NaN.toFixed(2) is "NaN" - the SDK passes it through, so the rate is
    // present but unusable. What matters is that the function did not throw.
    assert.ok(res.body.rateResponse || res.body.error);
    await fakeVendors.control({shippingRate: "9.42"});
  });

// Finding S4. This branch had no coverage at all, and it was the one that
// leaked: the old handler answered with the raw vendor error object AND
// the caller's own body, to an anonymous caller.
test("a real vendor failure is a 502 that leaks nothing", async () => {
  await fakeVendors.control({shippingRatesStatus: 500});
  try {
    const res = await callHttp("get_shipping_rates", rateRequest(16));

    assert.equal(res.status, 502);
    assert.deepEqual(res.body, {
      error: "Unable to retrieve shipping rates",
    });

    // The fake's error body carries account-scoped detail on purpose.
    // None of it, and none of the request we sent, may come back.
    const raw = JSON.stringify(res.body);
    assert.ok(!raw.includes("se-acct-778899"), "leaked account id");
    assert.ok(!raw.includes("se-req-00000000"), "leaked vendor request id");
    assert.ok(!raw.includes("shipengine"), "leaked vendor identity");
    assert.ok(!raw.includes("30301"), "echoed the caller's own body");
  } finally {
    await fakeVendors.control({shippingRatesStatus: 200});
  }
});

// The allowlist (utils/shipping-request.ts) is unit-tested in
// functions/test/shipping-request.test.js. This is the end-to-end half:
// a body that cannot describe a quote must be refused HERE, without the
// vendor being contacted at all.
test("a malformed body is refused without touching the vendor",
  async () => {
    await fakeVendors.reset();
    const res = await callHttp("get_shipping_rates", {garbage: true});

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {error: "Invalid shipping rate request"});

    const calls = await fakeVendors.log("shipengine");
    const rateCalls = calls.filter((c) => c.op === "rates");
    assert.equal(rateCalls.length, 0, "vendor was contacted anyway");
  });

// ---------------------------------------------------------------------------
// Labels - staff only. This is the endpoint that spends money.
// ---------------------------------------------------------------------------

test("get_shipping_label REFUSES an anonymous caller and buys nothing",
  async () => {
    const res = await callHttp("get_shipping_label", {shipId: "se-rate-ground"});

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, {code: 401, error: "Unauthorized"});
    // The real assertion: the vendor was never asked to create a label, so
    // no postage was spent. A 401 that still bought a label would be worse
    // than no gate at all.
    assert.equal((await fakeVendors.log("shipengine")).length, 0);
  });

test("get_shipping_label REFUSES a malformed bearer token", async () => {
  const res = await callHttp(
    "get_shipping_label", {shipId: "se-rate-ground"},
    {Authorization: "Bearer not-a-real-token"}
  );
  assert.equal(res.status, 401);
  assert.equal((await fakeVendors.log("shipengine")).length, 0);
});

test("get_shipping_label REFUSES a valid Firebase user who is not staff",
  async () => {
    // The gate is not "signed in", it is "has an admin_users record".
    // patron@test.local is a real, seeded, sign-in-able account with no
    // admin_users row - exactly the account a reader patron holds.
    const patronToken = await signIn("patron@test.local");
    const res = await callHttp(
      "get_shipping_label", {shipId: "se-rate-ground"},
      {Authorization: `Bearer ${patronToken}`}
    );

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, {code: 401, error: "Unauthorized"});
    assert.equal((await fakeVendors.log("shipengine")).length, 0);
  });

test("get_shipping_label buys a label for a staff caller and returns the " +
  "download link", async () => {
  const res = await callHttp(
    "get_shipping_label", {shipId: "se-rate-ground"},
    {Authorization: `Bearer ${staffToken}`}
  );

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.trackingNumber, "FAKETRACK0001");
  assert.equal(res.body.labelId, "se-fake-label-0001");
  assert.match(res.body.labelDownload.pdf, /\.pdf$/);
});

// ---------------------------------------------------------------------------
// Finding S3 - the label is bought from OUR stored shipment, not a rate id
// ---------------------------------------------------------------------------
//
// The attack: get_shipping_rates is anonymous, so anyone could mint a rate
// id describing a heavy shipment to their own address, attach it to a small
// real order, and have staff buy their postage by clicking Print Label.
// The purchase path no longer uses the stored rate id at all.

// A purchase carrying a rate id an attacker could have planted, and a
// shipping address that is unmistakably the CUSTOMER's.
const VICTIM_PURCHASE = "purchase-s3-guard";
const ATTACKER_ZIP = "99501"; // Anchorage - nowhere near the seeded org
const CUSTOMER_ZIP = "30263";

const seedShippablePurchase = async (db, overrides = {}) => {
  await db.collection("products").doc("product-s3").set({
    title: "Heavy Book", isActive: true, weight: 12,
  });
  await db.collection("purchases").doc(VICTIM_PURCHASE).set({
    firstName: "Pat", lastName: "Buyer", email: "pat@buyer.test",
    phone: {number: "555-0199"},
    shippingAddress: {
      address1: "1 Peachtree St", city: "Newnan", state: "GA",
      zip: CUSTOMER_ZIP, country: "US",
    },
    cartItems: [{id: "product-s3", orderQuantity: 2, isEvent: false}],
    // What the shopper was charged at checkout.
    shippingRate: 4.25,
    // The planted rate id. It must never be used.
    shippingRateId: {rateId: "se-rate-attacker", shippingAmount: {amount: 1}},
    ...overrides,
  });
};

test("a label is bought from the PURCHASE's address, never the stored " +
  "rate id", async () => {
  const db = getDb();
  await seedShippablePurchase(db);

  const res = await callHttp(
    "get_shipping_label",
    {purchaseId: VICTIM_PURCHASE, shipId: "se-rate-attacker"},
    {Authorization: `Bearer ${staffToken}`}
  );
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const calls = await fakeVendors.log("shipengine");
  const fromRate = calls.filter((c) => c.op === "label");
  const fromShipment = calls.filter((c) => c.op === "label-from-shipment");

  // The whole finding in one assertion.
  assert.equal(fromShipment.length, 1, "did not buy from shipment details");
  assert.equal(fromRate[0].rateId, "(from-shipment-details)",
    "a caller-supplied rate id reached the vendor");

  // The address we sent is the customer's, off the purchase doc.
  assert.equal(fromShipment[0].postalCode, CUSTOMER_ZIP);
  assert.equal(fromShipment[0].addressLine1, "1 Peachtree St");
  assert.equal(fromShipment[0].name, "Pat Buyer");

  // Weight is recomputed from the PRODUCT (12oz x 2), not from the cart
  // line, which carried no weight at all here.
  assert.equal(fromShipment[0].weight, 24);
});

test("an attacker's destination on the purchase cannot redirect postage",
  async () => {
    const db = getDb();
    await seedShippablePurchase(db);
    // Even if the planted rate claims Anchorage, we ship where the
    // purchase says. The rate id is never dereferenced.
    await db.collection("purchases").doc(VICTIM_PURCHASE).set({
      shippingRateId: {
        rateId: "se-rate-attacker",
        shipTo: {postalCode: ATTACKER_ZIP},
      },
    }, {merge: true});

    const res = await callHttp(
      "get_shipping_label", {purchaseId: VICTIM_PURCHASE},
      {Authorization: `Bearer ${staffToken}`}
    );
    assert.equal(res.status, 200);

    const sent = (await fakeVendors.log("shipengine"))
      .find((c) => c.op === "label-from-shipment");
    assert.equal(sent.postalCode, CUSTOMER_ZIP);
    assert.notEqual(sent.postalCode, ATTACKER_ZIP);
  });

test("the shipping cost drift is recorded on the purchase", async () => {
  const db = getDb();
  await seedShippablePurchase(db);
  // Customer was charged 4.25 at checkout; the label costs 9.42.
  await fakeVendors.control({shippingRate: "9.42"});

  const res = await callHttp(
    "get_shipping_label", {purchaseId: VICTIM_PURCHASE},
    {Authorization: `Bearer ${staffToken}`}
  );
  assert.equal(res.status, 200);

  const saved = (await db.collection("purchases")
    .doc(VICTIM_PURCHASE).get()).data();
  assert.ok(saved.shippingCostDrift, "drift was not recorded");
  assert.equal(saved.shippingCostDrift.quoted, 4.25);
  assert.equal(saved.shippingCostDrift.actual, 9.42);
  // Positive = the org absorbed the difference.
  assert.equal(saved.shippingCostDrift.drift, 5.17);
  assert.ok(saved.shippingCostDrift.at, "no timestamp on the drift record");

  // ...and it comes back on the response so the screen can show it at once.
  assert.equal(res.body.shippingCostDrift.drift, 5.17);
});

test("an unshippable purchase is refused before the vendor is called",
  async () => {
    const db = getDb();
    await seedShippablePurchase(db, {shippingAddress: {city: "Newnan"}});

    const res = await callHttp(
      "get_shipping_label", {purchaseId: VICTIM_PURCHASE},
      {Authorization: `Bearer ${staffToken}`}
    );
    assert.equal(res.status, 400);
    assert.equal((await fakeVendors.log("shipengine")).length, 0,
      "postage was spent on an undeliverable order");
  });

test("an unknown purchase id buys nothing", async () => {
  const res = await callHttp(
    "get_shipping_label", {purchaseId: "no-such-purchase"},
    {Authorization: `Bearer ${staffToken}`}
  );
  assert.equal(res.status, 400);
  assert.equal((await fakeVendors.log("shipengine")).length, 0);
});

test("the label is bought against the RATE the caller chose, with the " +
  "fixed 4x6 PDF options", async () => {
  // shipId comes from the client; everything else about the label is
  // decided server-side. Both halves are worth pinning - the rate id
  // reaching the carrier unchanged is what makes the purchase correct, and
  // the options being server-fixed is what stops a caller choosing them.
  await callHttp(
    "get_shipping_label", {shipId: "se-rate-express"},
    {Authorization: `Bearer ${staffToken}`}
  );

  const [call] = await fakeVendors.log("shipengine");
  assert.equal(call.op, "label");
  assert.equal(call.rateId, "se-rate-express");
  assert.equal(call.params.label_layout, "4x6");
  assert.equal(call.params.label_format, "pdf");
  assert.equal(call.params.label_download_type, "url");
  assert.equal(call.params.validate_address, "no_validation");
});
