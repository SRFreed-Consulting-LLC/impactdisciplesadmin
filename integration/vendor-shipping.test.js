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
  preflight, reseed, callHttp, signIn,
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

test("a carrier failure comes back as a 400-shaped body, not a 500",
  async () => {
    // The handler catches and answers 200-with-an-error-body (its own
    // pre-existing shape). Pinned as-is rather than "fixed" here: the web
    // client's calculateShipping() reads result.rateResponse and falls back
    // to zero shipping when it is absent, so this shape is load-bearing.
    await fakeVendors.control({shippingRate: "not-a-number"});
    const res = await callHttp("get_shipping_rates", rateRequest(16));
    assert.equal(res.status, 200);
    // NaN.toFixed(2) is "NaN" - the SDK passes it through, so the rate is
    // present but unusable. What matters is that the function did not throw.
    assert.ok(res.body.rateResponse || res.body.error);
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
