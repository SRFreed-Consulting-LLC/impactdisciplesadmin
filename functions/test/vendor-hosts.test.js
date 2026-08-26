// Unit tests for the vendor base-URL seam (utils/vendor-hosts.ts).
//
// This is a SECURITY test, not a plumbing test. The whole point of the seam
// is that emulator runs can redirect PayPal/apilayer/ShipEngine at a fake
// server so the money path becomes testable. The hazard it creates is the
// mirror image: if that redirect could ever take effect on a deployed
// project, anyone able to set an env var could point real payment
// verification at a server they control - minting free orders and free book
// licences. So the interesting assertions below are the ones about when the
// override is REFUSED.
//
// Runs against ../lib via `npm test`.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {
  VENDOR_BASE_ENV,
  fakeVendorsAllowed,
  resolveVendorBase,
} = require("../lib/utils/vendor-hosts");

const PAYPAL_LIVE = "https://api-m.paypal.com";
const FAKE = "http://127.0.0.1:5055";

// Shapes of the environment a function can find itself running in.
const EMULATOR = {FUNCTIONS_EMULATOR: "true", GCLOUD_PROJECT: "demo-impact"};
const DEMO_PROJECT = {GCLOUD_PROJECT: "demo-impact"};
const PROD = {GCLOUD_PROJECT: "impactdisciples-a82a8"};
const DEV = {GCLOUD_PROJECT: "impactdisciplesdev"};

test("no override set: always the real vendor host, in every " +
  "environment", () => {
  for (const env of [EMULATOR, DEMO_PROJECT, PROD, DEV, {}]) {
    assert.equal(resolveVendorBase("paypal", PAYPAL_LIVE, env), PAYPAL_LIVE);
  }
});

test("override is honoured under the Functions emulator", () => {
  const env = {...EMULATOR, [VENDOR_BASE_ENV.paypal]: FAKE};
  assert.equal(resolveVendorBase("paypal", PAYPAL_LIVE, env), FAKE);
});

test("override is honoured for a demo-* project without the emulator " +
  "flag", () => {
  // The integration suites talk to the emulator over REST from plain node,
  // where FUNCTIONS_EMULATOR is not set - the demo- prefix has to be enough
  // on its own. Firebase reserves demo-* for projects that can never reach
  // live Google infrastructure.
  const env = {...DEMO_PROJECT, [VENDOR_BASE_ENV.paypal]: FAKE};
  assert.equal(resolveVendorBase("paypal", PAYPAL_LIVE, env), FAKE);
});

test("override is REFUSED on the production project - falls back to " +
  "the real host", () => {
  const env = {...PROD, [VENDOR_BASE_ENV.paypal]: FAKE};
  assert.equal(resolveVendorBase("paypal", PAYPAL_LIVE, env), PAYPAL_LIVE);
});

test("override is REFUSED on the dev project too - dev transacts " +
  "against real PayPal sandbox", () => {
  const env = {...DEV, [VENDOR_BASE_ENV.paypal]: FAKE};
  assert.equal(resolveVendorBase("paypal", PAYPAL_LIVE, env), PAYPAL_LIVE);
});

test("override is REFUSED when the project id is unknown - fails " +
  "closed, not open", () => {
  // An env with no GCLOUD_PROJECT at all must not be treated as "probably a
  // test". Absence of proof is not proof of a sandbox.
  const env = {[VENDOR_BASE_ENV.paypal]: FAKE};
  assert.equal(resolveVendorBase("paypal", PAYPAL_LIVE, env), PAYPAL_LIVE);
});

test("a project merely CONTAINING 'demo-' is not a demo project", () => {
  // startsWith, not includes: "impactdisciples-demo-clone" is a real project.
  const env = {
    GCLOUD_PROJECT: "impactdisciples-demo-clone",
    [VENDOR_BASE_ENV.paypal]: FAKE,
  };
  assert.equal(resolveVendorBase("paypal", PAYPAL_LIVE, env), PAYPAL_LIVE);
});

test("FUNCTIONS_EMULATOR must be exactly 'true' - not merely present", () => {
  const env = {
    FUNCTIONS_EMULATOR: "false",
    GCLOUD_PROJECT: "impactdisciples-a82a8",
    [VENDOR_BASE_ENV.paypal]: FAKE,
  };
  assert.equal(resolveVendorBase("paypal", PAYPAL_LIVE, env), PAYPAL_LIVE);
});

test("refusing an override is logged loudly, with both deciding values", () => {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(" "));
  try {
    resolveVendorBase("paypal", PAYPAL_LIVE, {
      ...PROD, [VENDOR_BASE_ENV.paypal]: FAKE,
    });
  } finally {
    console.error = original;
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /REFUSING to redirect paypal/);
  assert.match(lines[0], /impactdisciples-a82a8/);
  assert.match(lines[0], /127\.0\.0\.1:5055/);
});

test("each vendor reads its own env var - they are not interchangeable", () => {
  // A single shared var would mean redirecting the tax service also
  // redirected PayPal, which is exactly the kind of blast radius this
  // shouldn't have.
  const env = {...EMULATOR, [VENDOR_BASE_ENV.tax]: FAKE};
  assert.equal(resolveVendorBase("paypal", PAYPAL_LIVE, env), PAYPAL_LIVE);
  assert.equal(
    resolveVendorBase("tax", "https://api.apilayer.com", env), FAKE
  );
});

test("a trailing slash on the override is trimmed so callers can " +
  "concatenate", () => {
  // Call sites build `${base}/v2/checkout/orders`; an untrimmed base would
  // produce a double slash, which PayPal's router 404s on.
  const env = {...EMULATOR, [VENDOR_BASE_ENV.paypal]: FAKE + "///"};
  assert.equal(resolveVendorBase("paypal", PAYPAL_LIVE, env), FAKE);
});

test("the real host is returned verbatim, trailing slash and all", () => {
  // ShipEngine's real base genuinely ends in a slash and the SDK expects it;
  // trimming applies only to the override.
  const env = {...EMULATOR};
  assert.equal(
    resolveVendorBase("shipengine", "https://api.shipengine.com/", env),
    "https://api.shipengine.com/"
  );
});

test("fakeVendorsAllowed agrees with resolveVendorBase about every " +
  "environment", () => {
  assert.equal(fakeVendorsAllowed(EMULATOR), true);
  assert.equal(fakeVendorsAllowed(DEMO_PROJECT), true);
  assert.equal(fakeVendorsAllowed(PROD), false);
  assert.equal(fakeVendorsAllowed(DEV), false);
  assert.equal(fakeVendorsAllowed({}), false);
});
