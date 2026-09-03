// Unit tests for the get_shipping_rates body allowlist (finding S4).
//
// This is a SECURITY test. get_shipping_rates is unauthenticated and its
// body reaches a CREDENTIALED ShipEngine client, so the interesting
// assertions are the ones about what does NOT survive sanitizing.
//
// The happy-path test doubles as the compatibility guard: it uses the
// exact shape both storefronts build from ShippingRequest, so an
// over-strict allowlist fails here rather than in checkout.
//
// Runs against ../lib via `npm test`.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {
  sanitizeRateRequest,
  toShipEngineAddress,
  buildLabelShipment,
  phoneDigits,
  countryCode,
  stateCode,
} = require("../lib/utils/shipping-request");
const {Countries} = require("../lib/common/shared/lists/countries.enum");
const {States} = require("../lib/common/shared/lists/states.enum");

// What the storefront's checkout ACTUALLY stores in shippingAddress.country
// - the dropdown's display value, not a code. Every real purchase on prod
// carries this string. Fixtures below use it, not "US", because a fixture
// with "US" is how the 2026-09-03 bug passed every test (see the regression
// block at the bottom).
const STORED_COUNTRY = "United States";
// Likewise the state: the dropdown's display value, never the code. The
// fixture said "GA" until 2026-09-03, which is how the second half of that
// bug (see the regression block) passed every test too.
const STORED_STATE = "Georgia";

// The vendor SDK's own request formatter. Used by exactly one test, which
// pins the fact that it silently drops fields our shipment does not send -
// including two the SDK's TYPES declare as required.
const {
  formatParams,
} = require("shipengine/cjs/create-label-from-shipment-details/format-params");

/**
 * The body both storefronts actually POST.
 * @return {object} A realistic rate request.
 */
function realBody() {
  return {
    rateOptions: {carrierIds: ["se-123456"]},
    shipment: {
      validateAddress: "no_validation",
      shipTo: {
        name: "Jane Buyer",
        phone: "5551234567",
        addressLine1: "12 Main St",
        cityLocality: "Newnan",
        // The web client copies shippingAddress.state/country straight in.
        stateProvince: STORED_STATE,
        postalCode: "30263",
        countryCode: STORED_COUNTRY,
        addressResidentialIndicator: "yes",
      },
      shipFrom: {
        companyName: "Impact Disciples",
        name: "Impact Disciples",
        phone: "5559876543",
        addressLine1: "1 Ministry Way",
        addressLine2: "Suite 2",
        cityLocality: "Newnan",
        stateProvince: "GA",
        postalCode: "30265",
        countryCode: "US",
        addressResidentialIndicator: "no",
      },
      packages: [{weight: {value: 12, unit: "ounce"}}],
    },
  };
}

test("a real storefront body survives intact", () => {
  const out = sanitizeRateRequest(realBody());
  assert.ok(out);
  assert.deepEqual(out.rateOptions, {carrierIds: ["se-123456"]});
  assert.equal(out.shipment.shipTo.postalCode, "30263");
  assert.equal(out.shipment.shipTo.name, "Jane Buyer");
  assert.equal(out.shipment.shipTo.countryCode, "US");
  assert.equal(out.shipment.shipTo.stateProvince, "GA");
  assert.equal(out.shipment.shipFrom.companyName, "Impact Disciples");
  assert.equal(out.shipment.shipFrom.addressLine2, "Suite 2");
  assert.deepEqual(out.shipment.packages, [
    {weight: {value: 12, unit: "ounce"}},
  ]);
});

test("unknown keys never reach the vendor", () => {
  const body = realBody();
  body.evil = "top level";
  body.shipment.evil = "shipment level";
  body.shipment.shipTo.evil = "address level";
  body.shipment.packages[0].evil = "package level";
  body.shipment.packages[0].weight.evil = "weight level";

  const out = sanitizeRateRequest(body);
  assert.ok(out);
  assert.equal(out.evil, undefined);
  assert.equal(out.shipment.evil, undefined);
  assert.equal(out.shipment.shipTo.evil, undefined);
  assert.equal(out.shipment.packages[0].evil, undefined);
  assert.equal(out.shipment.packages[0].weight.evil, undefined);
  // The whole payload, not just the top level.
  assert.ok(!JSON.stringify(out).includes("evil"));
});

test("validateAddress is ours, not the caller's", () => {
  const body = realBody();
  body.shipment.validateAddress = "validate_and_clean";
  const out = sanitizeRateRequest(body);
  assert.equal(out.shipment.validateAddress, "no_validation");
});

test("a body that cannot describe a quote is refused", () => {
  assert.equal(sanitizeRateRequest(undefined), null);
  assert.equal(sanitizeRateRequest(null), null);
  assert.equal(sanitizeRateRequest("a string"), null);
  assert.equal(sanitizeRateRequest([]), null);
  assert.equal(sanitizeRateRequest({}), null);
  assert.equal(sanitizeRateRequest({shipment: "nope"}), null);
});

test("a destination postal code is required", () => {
  const body = realBody();
  delete body.shipment.shipTo.postalCode;
  assert.equal(sanitizeRateRequest(body), null);
});

test("an origin and a destination are both required", () => {
  const noTo = realBody();
  delete noTo.shipment.shipTo;
  assert.equal(sanitizeRateRequest(noTo), null);

  const noFrom = realBody();
  delete noFrom.shipment.shipFrom;
  assert.equal(sanitizeRateRequest(noFrom), null);
});

test("packages must contain at least one weighable package", () => {
  const empty = realBody();
  empty.shipment.packages = [];
  assert.equal(sanitizeRateRequest(empty), null);

  const junk = realBody();
  junk.shipment.packages = ["nope", 42, null, {}, {weight: {}}];
  assert.equal(sanitizeRateRequest(junk), null);
});

test("non-finite and negative weights are dropped", () => {
  for (const value of [NaN, Infinity, -1, "heavy"]) {
    const body = realBody();
    body.shipment.packages = [{weight: {value, unit: "ounce"}}];
    assert.equal(sanitizeRateRequest(body), null, `value ${value}`);
  }
});

test("numeric strings are still accepted as weights", () => {
  const body = realBody();
  body.shipment.packages = [{weight: {value: "12.5", unit: "ounce"}}];
  const out = sanitizeRateRequest(body);
  assert.equal(out.shipment.packages[0].weight.value, 12.5);
});

test("oversized input is capped rather than forwarded", () => {
  const body = realBody();
  body.rateOptions.carrierIds = Array(50).fill("se-1");
  body.shipment.packages = Array(100).fill({
    weight: {value: 1, unit: "ounce"},
  });
  body.shipment.shipTo.addressLine1 = "x".repeat(5000);

  const out = sanitizeRateRequest(body);
  assert.equal(out.rateOptions.carrierIds.length, 10);
  assert.equal(out.shipment.packages.length, 20);
  assert.equal(out.shipment.shipTo.addressLine1.length, 100);
});

test("carrierIds: junk is dropped, absent means no rateOptions", () => {
  const mixed = realBody();
  mixed.rateOptions.carrierIds = ["se-1", 42, null, {}, "se-2"];
  assert.deepEqual(sanitizeRateRequest(mixed).rateOptions, {
    carrierIds: ["se-1", "se-2"],
  });

  // Omitted rather than defaulted - we do not invent a carrier set.
  const none = realBody();
  delete none.rateOptions;
  assert.equal(sanitizeRateRequest(none).rateOptions, undefined);

  const emptied = realBody();
  emptied.rateOptions.carrierIds = [];
  assert.equal(sanitizeRateRequest(emptied).rateOptions, undefined);
});

test("empty and whitespace-only strings are not copied", () => {
  const body = realBody();
  body.shipment.shipTo.phone = "   ";
  body.shipment.shipTo.name = "";
  const out = sanitizeRateRequest(body);
  assert.equal(out.shipment.shipTo.phone, undefined);
  assert.equal(out.shipment.shipTo.name, undefined);
  // ...but the address itself still stands on its postal code.
  assert.equal(out.shipment.shipTo.postalCode, "30263");
});

// ---------------------------------------------------------------------------
// Label purchase from shipment details (finding S3)
// ---------------------------------------------------------------------------

test("toShipEngineAddress maps our Address onto the vendor's names", () => {
  const out = toShipEngineAddress({
    address1: "12 Main St",
    address2: "Apt 4",
    city: "Newnan",
    state: "GA",
    zip: "30263",
    country: STORED_COUNTRY,
  }, "Jane Buyer", "5551234567");

  assert.equal(out.addressLine1, "12 Main St");
  assert.equal(out.addressLine2, "Apt 4");
  assert.equal(out.cityLocality, "Newnan");
  assert.equal(out.stateProvince, "GA");
  assert.equal(out.postalCode, "30263");
  assert.equal(out.countryCode, "US");
  assert.equal(out.name, "Jane Buyer");
  assert.equal(out.phone, "5551234567");
});

test("toShipEngineAddress refuses an undeliverable address", () => {
  assert.equal(toShipEngineAddress(undefined, "X"), undefined);
  assert.equal(toShipEngineAddress(null, "X"), undefined);
  assert.equal(toShipEngineAddress("nope", "X"), undefined);
  // No postal code and no street: nothing to deliver to.
  assert.equal(toShipEngineAddress({city: "Newnan"}, "X"), undefined);
  assert.equal(toShipEngineAddress({zip: "30263"}, "X"), undefined);
  assert.equal(toShipEngineAddress({address1: "12 Main St"}, "X"), undefined);
});

test("toShipEngineAddress defaults country and name sensibly", () => {
  const out = toShipEngineAddress(
    {address1: "12 Main St", zip: "30263"}, ""
  );
  assert.equal(out.countryCode, "US");
  assert.equal(out.name, "Customer");
  assert.equal(out.phone, undefined);
});

const ADDR = {addressLine1: "1 A St", postalCode: "30263", name: "X"};

// The two fields the vendor cannot buy a label without. Every shipment
// below carries them, because a shipment without them is not a shipment -
// see the regression test at the bottom of this file.
const SERVICE = {serviceCode: "ups_ground", carrierId: "se-1047625"};

test("buildLabelShipment assembles a shipment from server values", () => {
  const out = buildLabelShipment({
    ...SERVICE,
    shipTo: {...ADDR, postalCode: "30263"},
    shipFrom: {...ADDR, postalCode: "30277"},
    totalWeightOunces: 24,
  });
  assert.equal(out.validateAddress, "no_validation");
  assert.equal(out.shipTo.postalCode, "30263");
  assert.equal(out.shipFrom.postalCode, "30277");
  assert.deepEqual(out.packages, [{weight: {value: 24, unit: "ounce"}}]);
});

test("buildLabelShipment refuses what cannot be shipped", () => {
  const ok = {...SERVICE, shipTo: ADDR, shipFrom: ADDR, totalWeightOunces: 10};
  assert.ok(buildLabelShipment(ok));

  assert.equal(buildLabelShipment({...ok, shipTo: undefined}), null);
  assert.equal(buildLabelShipment({...ok, shipFrom: undefined}), null);
  // A zero-weight order is not a package - better to refuse than to buy
  // a label for it and discover that at the counter.
  assert.equal(buildLabelShipment({...ok, totalWeightOunces: 0}), null);
  assert.equal(buildLabelShipment({...ok, totalWeightOunces: -5}), null);
  assert.equal(buildLabelShipment({...ok, totalWeightOunces: NaN}), null);
});

test("buildLabelShipment carries no rate id - that is the point", () => {
  const out = buildLabelShipment({
    ...SERVICE, shipTo: ADDR, shipFrom: ADDR, totalWeightOunces: 8,
  });
  // service_code and carrier_id name a service level and our own billing
  // account. Neither is the rate id, and neither carries an address - which
  // is what makes carrying them over safe.
  assert.equal(out.serviceCode, "ups_ground");
  assert.equal(out.carrierId, "se-1047625");
  assert.ok(!JSON.stringify(out).includes("rateId"),
    "a rate reference survived into the buy");
});

// ---------------------------------------------------------------------------
// REGRESSION, 2026-09-02: the label with no carrier
// ---------------------------------------------------------------------------
//
// Shipped on 2026-08-28 and broke every Print Label click on production for
// five days. ShipEngine's POST /v1/labels needs carrier_id and service_code;
// this builder omitted both. Nothing caught it: the SDK client is typed
// `any`, so the vendor's own required-field types never applied, and the
// fake vendor answered 200 to any body. The operator saw only "Unable to
// purchase a shipping label."
//
// Refusing locally is the point - it costs no vendor round-trip and it lets
// the caller say WHICH precondition is missing.

test("buildLabelShipment refuses a shipment with no carrier or service",
  () => {
    const ok = {
      ...SERVICE, shipTo: ADDR, shipFrom: ADDR, totalWeightOunces: 10,
    };
    assert.equal(buildLabelShipment({...ok, serviceCode: undefined}), null);
    assert.equal(buildLabelShipment({...ok, carrierId: undefined}), null);
    assert.equal(buildLabelShipment({...ok, serviceCode: ""}), null);
    assert.equal(buildLabelShipment({...ok, carrierId: "   "}), null);
    // A number is not a service code. str() rejects it, and silently
    // sending one is how this failed the first time.
    assert.equal(buildLabelShipment({...ok, serviceCode: 7}), null);
  });

test("no ship date is set, because the SDK would drop it anyway", () => {
  const out = buildLabelShipment({
    ...SERVICE, shipTo: ADDR, shipFrom: ADDR, totalWeightOunces: 8,
  });
  // The SDK's Shipment type declares shipDate as REQUIRED and its
  // formatParams() does not map the field at all - it never reaches the
  // wire. ShipEngine defaults it to today, which is what we want: the rate
  // was quoted when the shopper checked out, possibly days earlier, and a
  // carrier refuses a ship date in the past. Setting it here would look
  // like it was being sent and would not be, which is precisely the shape
  // of the bug this file was fixed for.
  assert.equal(out.shipDate, undefined);
  assert.equal(formatParams({shipment: out}).shipment.ship_date, undefined,
    "the SDK started mapping shipDate - send one deliberately now");
});

// ---------------------------------------------------------------------------
// REGRESSION, 2026-09-03: "Customs items are required"
// ---------------------------------------------------------------------------
//
// The storefront stores shippingAddress.country as the dropdown's DISPLAY
// value, "United States". toShipEngineAddress forwarded it verbatim as
// country_code, so the ship-to country never equalled the ship-from's "US",
// ShipEngine classified every parcel as international and refused each label
// for lacking customs items. Every Print Label click on production failed
// from the S3 deploy until this fix.
//
// The test above this block used `country: "US"` - a value no real purchase
// holds - so it was green throughout. These tests use what is stored.

test("the storefront's stored country name becomes the vendor's ISO code",
  () => {
    const out = toShipEngineAddress(
      {address1: "12 Main St", zip: "30263", country: STORED_COUNTRY}, "X"
    );
    assert.equal(out.countryCode, "US");
  });

test("STORED_COUNTRY is still what the checkout dropdown produces", () => {
  // The web checkout defaults to Countries.US and stores the VALUE. If the
  // enum's text ever changes, the fixtures in this file drift away from
  // reality again - this pins them together.
  assert.equal(Countries.US, STORED_COUNTRY);
});

test("countryCode accepts a code or a name in any case", () => {
  assert.equal(countryCode("US"), "US");
  assert.equal(countryCode("us"), "US");
  assert.equal(countryCode(" US "), "US");
  assert.equal(countryCode("United States"), "US");
  assert.equal(countryCode("united states"), "US");
  assert.equal(countryCode("UNITED STATES"), "US");
  // Not US-specific: any name the dropdown offers maps to its code.
  assert.equal(countryCode("Canada"), "CA");
  assert.equal(countryCode(Countries.GB), "GB");
});

test("countryCode defaults an absent country to US", () => {
  assert.equal(countryCode(undefined), "US");
  assert.equal(countryCode(null), "US");
  assert.equal(countryCode(""), "US");
  assert.equal(countryCode("   "), "US");
  assert.equal(countryCode(840), "US"); // not a string: treated as absent
});

test("countryCode passes an unrecognised country through unchanged", () => {
  // Deliberate: silently mapping this to US would buy a DOMESTIC label for
  // a foreign address. Let the vendor refuse it with a message naming it.
  assert.equal(countryCode("Narnia"), "Narnia");
  assert.equal(countryCode("USA"), "USA");
});

test("every country name in the shared enum round-trips to its code", () => {
  // The whole dropdown, not a sample - a duplicate name or a typo'd code
  // anywhere in the enum would surface here rather than at a carrier.
  for (const [code, name] of Object.entries(Countries)) {
    assert.equal(countryCode(name), code, `name "${name}"`);
    assert.equal(countryCode(code), code, `code "${code}"`);
  }
});

test("the rate-quote sanitiser normalises the country too", () => {
  // The web client copies the stored name into the rate request as well.
  const body = realBody();
  body.shipment.shipTo.countryCode = "united states";
  body.shipment.shipFrom.countryCode = "US";
  const out = sanitizeRateRequest(body);
  assert.equal(out.shipment.shipTo.countryCode, "US");
  assert.equal(out.shipment.shipFrom.countryCode, "US");
});

test("a label shipment is domestic when both ends are stored as names",
  () => {
    // The end-to-end shape of the bug: both addresses off Firestore, both
    // holding display names, must come out equal so the vendor treats the
    // parcel as domestic and asks for no customs items.
    const shipTo = toShipEngineAddress(
      {address1: "12 Main St", zip: "30263", country: STORED_COUNTRY}, "X"
    );
    const shipFrom = toShipEngineAddress(
      {address1: "1 Ministry Way", zip: "30265", country: STORED_COUNTRY},
      "Impact Disciples"
    );
    const out = buildLabelShipment({
      ...SERVICE, shipTo, shipFrom, totalWeightOunces: 8,
    });
    assert.equal(out.shipTo.countryCode, "US");
    assert.equal(out.shipFrom.countryCode, "US");
    // And through the SDK's own formatter, on the wire, as country_code.
    const wire = formatParams({shipment: out}).shipment;
    assert.equal(wire.ship_to.country_code, "US");
    assert.equal(wire.ship_from.country_code, "US");
  });

// ---------------------------------------------------------------------------
// REGRESSION 2026-09-03, second half: the STATE is stored as a name too
// ---------------------------------------------------------------------------
//
// Sending "US" (above) is what made ShipEngine start enforcing "ship_to
// state_province must be two characters when ship_to country_code equals
// US". Every production rate quote 502'd within the hour of that deploy;
// the day before, the same request with country "United States" and state
// "Georgia" had returned 200. The fixture's stateProvince said "GA", so
// nothing here could go red.

test("STORED_STATE is still what the checkout dropdown produces", () => {
  assert.equal(States.GA, STORED_STATE);
});

test("stateCode accepts a code or a name in any case", () => {
  assert.equal(stateCode("GA"), "GA");
  assert.equal(stateCode("ga"), "GA");
  assert.equal(stateCode(" GA "), "GA");
  assert.equal(stateCode("Georgia"), "GA");
  assert.equal(stateCode("georgia"), "GA");
  assert.equal(stateCode("GEORGIA"), "GA");
  assert.equal(stateCode("New Hampshire"), "NH");
});

test("stateCode has NO default - an absent state stays absent", () => {
  assert.equal(stateCode(undefined), undefined);
  assert.equal(stateCode(null), undefined);
  assert.equal(stateCode(""), undefined);
  assert.equal(stateCode("   "), undefined);
  assert.equal(stateCode(13), undefined);
});

test("stateCode passes an unrecognised region through unchanged", () => {
  // A Canadian province is not in the US enum and must reach the vendor
  // exactly as typed, for the vendor to accept or refuse by name.
  assert.equal(stateCode("Ontario"), "Ontario");
  assert.equal(stateCode("ON"), "ON");
});

test("every state name in the shared enum round-trips to its code", () => {
  for (const [code, name] of Object.entries(States)) {
    assert.equal(stateCode(name), code, `name "${name}"`);
    assert.equal(stateCode(code), code, `code "${code}"`);
  }
});

test("the rate-quote sanitiser sends a two-letter state with a US country",
  () => {
    // The exact production request that 502'd: both stored as names.
    const body = realBody();
    body.shipment.shipTo.stateProvince = "Georgia";
    body.shipment.shipTo.countryCode = "United States";
    body.shipment.shipFrom.stateProvince = "georgia";
    const out = sanitizeRateRequest(body);
    assert.equal(out.shipment.shipTo.countryCode, "US");
    assert.equal(out.shipment.shipTo.stateProvince, "GA");
    assert.equal(out.shipment.shipFrom.stateProvince, "GA");
  });

test("a label address sends a two-letter state on the wire", () => {
  const out = toShipEngineAddress(
    {address1: "12 Main St", city: "Newnan", state: STORED_STATE,
      zip: "30263", country: STORED_COUNTRY}, "X"
  );
  assert.equal(out.stateProvince, "GA");
  const shipment = buildLabelShipment({
    ...SERVICE, shipTo: out, shipFrom: out, totalWeightOunces: 8,
  });
  const wire = formatParams({shipment}).shipment;
  assert.equal(wire.ship_to.state_province, "GA");
  assert.equal(wire.ship_to.country_code, "US");
});

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

test("phoneDigits keeps what a carrier can dial and drops what it cannot",
  () => {
    assert.equal(phoneDigits("(678) 854-9322"), "6788549322");
    // The org phone is stored in `config` as a NUMBER. str() rejected it,
    // so the ship-from phone was dropped from every label ever bought.
    assert.equal(phoneDigits(6788549322), "6788549322");
    assert.equal(phoneDigits("+1 678-854-9322"), "16788549322");

    // UPS refuses a ShipTo phone under ten characters - better to omit the
    // field than to have the vendor reject the whole label for it.
    assert.equal(phoneDigits("555-0199"), undefined);
    assert.equal(phoneDigits("n/a"), undefined);
    assert.equal(phoneDigits(""), undefined);
    assert.equal(phoneDigits(undefined), undefined);
    assert.equal(phoneDigits(null), undefined);
    assert.equal(phoneDigits({number: "6788549322"}), undefined);
  });
