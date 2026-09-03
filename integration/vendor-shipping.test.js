const {tenantPath} = require("../scripts/lib/tenancy");
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
// The country dropdown the storefront checkout renders, as compiled for the
// functions (the emulator runs lib/, so it is always built when this suite
// can run at all). Keys are ISO codes, values are the display names the
// checkout STORES. Read from here rather than retyped so the fixtures
// below cannot drift from what the dropdown actually offers.
const {Countries} = require(
  "../functions/lib/common/shared/lists/countries.enum");

// What the storefront's checkout stores in shippingAddress.country, and
// copies verbatim into the rate request's shipTo.countryCode: the country
// dropdown's DISPLAY value, not an ISO code. Every real purchase carries
// this exact string. The fixtures here use it because fixtures that said
// "US" are how the 2026-09-03 customs bug passed a green suite - see the
// regression block at the bottom of this file.
const STORED_COUNTRY = Countries.US;

// Likewise the state: the dropdown's display value ("Georgia"), never the
// USPS code. The fixtures said "GA" until the afternoon of 2026-09-03, which
// is how the second half of that day's bug - the vendor refusing a state
// name once the country is "US" - passed the same green suite.
const {States} = require("../functions/lib/common/shared/lists/states.enum");
const STORED_STATE = States.GA;
const STORED_STATE_CODE = "GA";

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
      stateProvince: STORED_STATE,
      postalCode: "30301",
      countryCode: STORED_COUNTRY,
      addressResidentialIndicator: "yes",
    },
    shipFrom: {
      name: "Impact Disciples",
      phone: "555-0100",
      addressLine1: "1 Test Way",
      cityLocality: "Atlanta",
      // The org's config address stores "Georgia" too (see the fixtures).
      stateProvince: STORED_STATE,
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
  await db.collection(tenantPath("products")).doc("product-s3").set({
    title: "Heavy Book", isActive: true, weight: 12,
  });
  await db.collection(tenantPath("purchases")).doc(VICTIM_PURCHASE).set({
    firstName: "Pat", lastName: "Buyer", email: "pat@buyer.test",
    phone: {number: "555-0199"},
    shippingAddress: {
      address1: "1 Peachtree St", city: "Newnan", state: STORED_STATE,
      zip: CUSTOMER_ZIP, country: STORED_COUNTRY,
    },
    cartItems: [{id: "product-s3", orderQuantity: 2, isEvent: false}],
    // What the shopper was charged at checkout.
    shippingRate: 4.25,
    // The planted rate id. It must never be used. serviceCode and carrierId
    // beside it MUST be - they are what the vendor buys the label with, and
    // real purchases carry them (401 of 401 with a stored rate on prod).
    // The fixture lacked them until 2026-09-02, which is half the reason
    // the missing-carrier bug survived a passing suite.
    shippingRateId: {
      rateId: "se-rate-attacker",
      shippingAmount: {amount: 1},
      serviceCode: "ups_ground",
      carrierId: "se-1047625",
    },
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
    await db.collection(tenantPath("purchases")).doc(VICTIM_PURCHASE).set({
      shippingRateId: {
        rateId: "se-rate-attacker",
        shipTo: {postalCode: ATTACKER_ZIP},
        // The service level is read from here; the address next to it is
        // not, and that is exactly what this test proves.
        serviceCode: "ups_ground",
        carrierId: "se-1047625",
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

  const saved = (await db.collection(tenantPath("purchases"))
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

// ---------------------------------------------------------------------------
// REGRESSION, 2026-09-02: the label with no carrier
// ---------------------------------------------------------------------------
//
// Between the S3 deploy (2026-08-28 21:50 UTC) and this fix, EVERY Print
// Label click on production failed. The shipment carried no carrier_id and
// no service_code - ShipEngine 400s without them - and the operator saw
// only "Unable to purchase a shipping label."
//
// It survived a green suite because both of the things that should have
// caught it were blind: the SDK client is typed `any` (it is lazily
// require()d), so the vendor's own required-field types never applied, and
// scripts/fake-vendors.js answered 200 to any body at all. The fake is
// strict now, which is what gives the first test below its teeth.

test("the label carries the carrier and service level from the stored rate",
  async () => {
    const db = getDb();
    await seedShippablePurchase(db);

    const res = await callHttp(
      "get_shipping_label", {purchaseId: VICTIM_PURCHASE},
      {Authorization: `Bearer ${staffToken}`}
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const sent = (await fakeVendors.log("shipengine"))
      .find((c) => c.op === "label-from-shipment");
    // Without these two the vendor refuses the buy. This is the assertion
    // whose absence let the bug ship.
    assert.equal(sent.serviceCode, "ups_ground");
    assert.equal(sent.carrierId, "se-1047625");
    // No ship date: the SDK drops the field even though its own types call
    // it required, and ShipEngine defaults it to today. See the note in
    // shipping-request.ts.
    assert.equal(sent.shipDate, undefined);
  });

test("an order with no shipping service is refused with a reason, and " +
  "buys nothing", async () => {
  const db = getDb();
  // 163 truly-physical orders on prod are in this state: placed without a
  // shipping quote, so there is no service level to buy. They were never
  // labellable from this screen - the point is that the operator is now
  // told WHY, and pointed at the screen that can do it.
  await seedShippablePurchase(db, {
    shippingRateId: {rateId: "se-rate-attacker"},
  });

  const res = await callHttp(
    "get_shipping_label", {purchaseId: VICTIM_PURCHASE},
    {Authorization: `Bearer ${staffToken}`}
  );

  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /no shipping service/i);
  assert.match(res.body.error.message, /Shipping Labels/);
  assert.equal((await fakeVendors.log("shipengine")).length, 0,
    "the vendor was called for a shipment it cannot buy");
});

test("each refusal names its own cause rather than one generic message",
  async () => {
    const db = getDb();
    const ask = async () => {
      const res = await callHttp(
        "get_shipping_label", {purchaseId: VICTIM_PURCHASE},
        {Authorization: `Bearer ${staffToken}`}
      );
      assert.equal(res.status, 400);
      return res.body.error.message;
    };

    // No address to ship to.
    await seedShippablePurchase(db, {shippingAddress: {city: "Newnan"}});
    assert.match(await ask(), /address or ZIP/i);

    // Nothing on the order weighs anything.
    await seedShippablePurchase(db, {
      cartItems: [{id: "product-weightless", orderQuantity: 1}],
    });
    assert.match(await ask(), /weight/i);

    // These are the messages an operator reads at 9pm with a parcel in
    // hand. "Purchase is not shippable." was true of all three.
    assert.equal((await fakeVendors.log("shipengine")).length, 0);
  });

test("the customer's phone reaches the carrier, and the org's stands in " +
  "when there is none", async () => {
  const db = getDb();

  await seedShippablePurchase(db);
  await callHttp(
    "get_shipping_label", {purchaseId: VICTIM_PURCHASE},
    {Authorization: `Bearer ${staffToken}`}
  );
  let sent = (await fakeVendors.log("shipengine"))
    .find((c) => c.op === "label-from-shipment");
  // The seeded customer phone is 555-0199 - EIGHT digits. UPS refuses a
  // ShipTo phone under ten characters, so it is dropped rather than sent,
  // and the org's number stands in. A short phone used to cost the whole
  // label: one of dev's four stranded orders died on exactly that.
  assert.ok(sent.phone === undefined || sent.phone.length >= 10,
    `an undialable phone reached the carrier: ${sent.phone}`);

  await fakeVendors.reset();
  await seedShippablePurchase(db, {phone: {number: "(770) 555-0142"}});
  await callHttp(
    "get_shipping_label", {purchaseId: VICTIM_PURCHASE},
    {Authorization: `Bearer ${staffToken}`}
  );
  sent = (await fakeVendors.log("shipengine"))
    .find((c) => c.op === "label-from-shipment");
  assert.equal(sent.phone, "7705550142");
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

// ---------------------------------------------------------------------------
// REGRESSION, 2026-09-03: "Customs items are required"
// ---------------------------------------------------------------------------
//
// The storefront stores shippingAddress.country as the dropdown's display
// value - "United States" - and the label builder forwarded it verbatim as
// country_code. ShipEngine saw a ship-to country that was not equal to the
// ship-from's "US", classified every parcel as international and refused
// each label for lacking customs items. Every Print Label click on
// production failed from the S3 deploy until this fix.
//
// It passed a green suite because every fixture in this file said
// `country: "US"` - a value no real purchase holds - and because the fake
// vendor bought a label for any pair of countries. Both are fixed: the
// fixtures now hold what the dropdown stores, and the fake refuses an
// international shipment without customs exactly as the vendor does.

const STORED_COUNTRY_CODE = "US";

test("a purchase stored with the dropdown's country name ships DOMESTIC",
  async () => {
    const db = getDb();
    // seedShippablePurchase already stores Countries.US - said explicitly
    // here because it is the whole point of the test.
    await seedShippablePurchase(db, {
      shippingAddress: {
        address1: "1 Peachtree St", city: "Newnan", state: "GA",
        zip: CUSTOMER_ZIP, country: Countries.US,
      },
    });

    const res = await callHttp(
      "get_shipping_label", {purchaseId: VICTIM_PURCHASE},
      {Authorization: `Bearer ${staffToken}`}
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const sent = (await fakeVendors.log("shipengine"))
      .find((c) => c.op === "label-from-shipment");
    // Both ends as ISO codes, and EQUAL - that equality is what the vendor
    // uses to decide whether customs declarations are needed.
    assert.equal(sent.countryCode, STORED_COUNTRY_CODE);
    assert.equal(sent.fromCountryCode, STORED_COUNTRY_CODE);
    assert.notEqual(sent.countryCode, Countries.US,
      "the display name reached the carrier as a country code");
  });

test("the org's ship-from country is normalised too, whatever config holds",
  async () => {
    const db = getDb();
    // Web Config's address is edited by staff in the admin app - nothing
    // stops it holding the display name either. The seeded fixture says
    // "US"; this flips it to the name and expects the same domestic label.
    const configRef = db.collection(tenantPath("config"));
    const snap = await configRef.limit(1).get();
    assert.ok(!snap.empty, "no seeded config doc");
    const configDoc = snap.docs[0];
    const original = configDoc.data().address;
    try {
      await configDoc.ref.set(
        {address: {...original, country: Countries.US}}, {merge: true});
      await seedShippablePurchase(db);

      const res = await callHttp(
        "get_shipping_label", {purchaseId: VICTIM_PURCHASE},
        {Authorization: `Bearer ${staffToken}`}
      );
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const sent = (await fakeVendors.log("shipengine"))
        .find((c) => c.op === "label-from-shipment");
      assert.equal(sent.fromCountryCode, STORED_COUNTRY_CODE);
    } finally {
      await configDoc.ref.set({address: original}, {merge: true});
    }
  });

test("a rate quote carrying the dropdown's country name is still domestic",
  async () => {
    // rateRequest() sends Countries.US in shipTo.countryCode, exactly as
    // the web client does. The vendor must see "US".
    const res = await callHttp("get_shipping_rates", rateRequest(16));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const [call] = await fakeVendors.log("shipengine");
    assert.equal(call.op, "rates");
    assert.equal(call.countryCode, STORED_COUNTRY_CODE);
  });

// ---------------------------------------------------------------------------
// REGRESSION 2026-09-03 (afternoon): the STATE is stored as a name too
// ---------------------------------------------------------------------------
//
// Once the country reached the vendor as "US", ShipEngine began enforcing
// "ship_to state_province must be two characters when ship_to country_code
// equals US" and every production rate quote 502'd for three and a half
// hours. The fake now enforces the same rule (scripts/fake-vendors.js,
// usStateViolation), so these go RED if the state ever reaches it as a name.

test("STORED_STATE is still what the checkout dropdown produces", () => {
  assert.equal(STORED_STATE, "Georgia");
});

test("a rate quote carrying the dropdown's STATE name reaches the carrier " +
  "as the two-letter code, and is quoted", async () => {
  // rateRequest() sends States.GA ("Georgia") in both addresses, exactly as
  // the web client and the org config do. The production request that
  // 502'd, through the real function, against a fake that refuses it.
  const res = await callHttp("get_shipping_rates", rateRequest(16));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const [call] = await fakeVendors.log("shipengine");
  assert.equal(call.op, "rates");
  assert.equal(call.stateProvince, STORED_STATE_CODE);
  assert.equal(call.countryCode, STORED_COUNTRY_CODE);
});

test("a label for a purchase stored with the STATE name is bought, with " +
  "the two-letter code on the wire", async () => {
  const db = getDb();
  await seedShippablePurchase(db); // shippingAddress.state = "Georgia"
  const res = await callHttp(
    "get_shipping_label", {purchaseId: VICTIM_PURCHASE},
    {Authorization: `Bearer ${staffToken}`}
  );
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const sent = (await fakeVendors.log("shipengine"))
    .find((c) => c.op === "label-from-shipment");
  assert.ok(sent, "the vendor was never asked");
  assert.equal(sent.stateProvince, STORED_STATE_CODE);
  assert.equal(sent.countryCode, STORED_COUNTRY_CODE);
});

test("the fake refuses a state NAME with a US country, in the vendor's " +
  "words - so the two tests above can actually fail", async () => {
  // Straight at the fake, bypassing our sanitiser: proves the guard is
  // real rather than the suite passing because nothing checks.
  const res = await fetch("http://127.0.0.1:5055/v1/rates", {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({shipment: {
      ship_to: {state_province: "Georgia", country_code: "US",
        postal_code: "30301"},
      ship_from: {state_province: "GA", country_code: "US"},
      packages: [{weight: {value: 1, unit: "ounce"}}],
    }}),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.errors[0].message,
    /ship_to state_province must be two characters/);
});

// A spread of destinations a shopper could pick from the same dropdown. The
// test walks the ENUM for each (code -> stored name) rather than typing the
// names, so it is testing what the dropdown produces, not what we assume it
// does. Chosen to cover a neighbour, Europe, Asia-Pacific and a name with a
// space in it.
const FOREIGN = ["CA", "MX", "GB", "DE", "AU", "JP", "NZ"];

for (const code of FOREIGN) {
  const storedName = Countries[code];
  test(`a shopper who picked "${storedName}" reaches the carrier as ` +
    `${code}, and is refused for customs rather than shipped as domestic`,
  async () => {
    assert.ok(storedName, `Countries.${code} is not in the dropdown`);
    const db = getDb();
    await seedShippablePurchase(db, {
      shippingAddress: {
        address1: "1 Foreign Way", city: "Elsewhere",
        zip: "00000", country: storedName,
      },
    });

    const res = await callHttp(
      "get_shipping_label", {purchaseId: VICTIM_PURCHASE},
      {Authorization: `Bearer ${staffToken}`}
    );

    const sent = (await fakeVendors.log("shipengine"))
      .find((c) => c.op === "label-from-shipment");
    assert.ok(sent, "the vendor was never asked");
    // The right ISO code - neither the display name nor a silent "US".
    assert.equal(sent.countryCode, code);
    assert.equal(sent.fromCountryCode, STORED_COUNTRY_CODE);

    // We send no customs declarations, so the vendor refuses this - and
    // the operator must be told WHY, in the vendor's words, rather than
    // have a domestic label bought for a foreign address. Until the org
    // ships internationally, this refusal is the correct outcome.
    assert.equal(res.status, 502, JSON.stringify(res.body));
    assert.match(res.body.error.message, /The carrier refused this label/);
    assert.match(res.body.error.message, /Customs items are required/);
  });
}

test("a country the dropdown does not offer is passed through, not " +
  "guessed", async () => {
  const db = getDb();
  await seedShippablePurchase(db, {
    shippingAddress: {
      address1: "1 Nowhere Rd", zip: "00000", country: "Narnia",
    },
  });
  await callHttp(
    "get_shipping_label", {purchaseId: VICTIM_PURCHASE},
    {Authorization: `Bearer ${staffToken}`}
  );
  const sent = (await fakeVendors.log("shipengine"))
    .find((c) => c.op === "label-from-shipment");
  // Relabelling an unknown country as US would buy a domestic label for a
  // foreign address. It goes to the vendor as stored, to be refused by name.
  assert.equal(sent.countryCode, "Narnia");
});
