const {tenantPath} = require("../scripts/lib/tenancy");
// Integration: the PAID checkout path, end to end, through the real
// create_paypal_order / capture_paypal_order Cloud Functions in the
// emulator - with PayPal and the apilayer tax service standing in as
// scripts/fake-vendors.js.
//
// WHY THIS FILE EXISTS
// money.test.js covers the FREE path and, for anything paid, could only
// assert that the request died at the vendor boundary: the fixture world had
// no `config` document, so create_paypal_order threw at getPaypalClientId()
// before any network call and every paid test pinned the same
// 400 "Unable to start checkout". capture_paypal_order had no coverage at
// all - a real capture needs buyer approval in a browser, so it cannot be
// automated even against PayPal sandbox. And the Georgia tax branch was
// actively steered around: both money.test.js and the cross-app suite use a
// Texas address ON PURPOSE, because tax only computes for Georgia and the
// lookup was a live network call.
//
// So the highest-consequence code in the repo - the code that decides how
// much money moves and whether a Purchase is written - was the least
// covered. Seeding `config` and redirecting the vendors is what makes it
// reachable. What is pinned below is deliberately weighted toward REFUSAL:
// a capture whose amount does not match, a capture PayPal did not complete,
// a replayed capture. Those are the assertions that matter, because the
// failure they guard against silently gives goods away.
//
// LIMIT, stated plainly: a fake proves OUR logic, never PayPal's. If PayPal
// changes a field name this suite stays green and production breaks. That is
// what the periodic manual sandbox check is for - see scripts/fake-vendors.js.
const {test, before, beforeEach} = require("node:test");
const assert = require("node:assert/strict");
const {
  getDb, preflight, reseed, callHttp,
  fakeVendors, preflightFakeVendors,
} = require("./helpers/emulator");

let db;

// Georgia, so the tax branch is actually entered. The zip is the scenario
// selector - see TAX_BY_ZIP in scripts/fake-vendors.js.
const gaAddress = (zip) => ({
  address1: "1 Peachtree St", city: "Atlanta",
  state: "Georgia", zip, country: "US",
});
const TX_ADDRESS = {
  address1: "1 Alamo Plz", city: "San Antonio",
  state: "Texas", zip: "78205", country: "US",
};

const orderBody = (overrides) => ({
  firstName: "Paid",
  lastName: "Buyer",
  email: "buyer@vendor.test",
  phone: "555-0000",
  isShippingSameAsBilling: true,
  shippingAddress: TX_ADDRESS,
  shippingRate: 0,
  cartItems: [],
  ...overrides,
});

// The fixture physical book: $20.00, weight 1, no campaign offer targets it.
const BOOK = {id: "prod-book-physical", orderQuantity: 2};

const purchasesByEmail = async (email) =>
  (await db.collection("purchases").where("email", "==", email).get()).docs;

const pendingOrder = async (orderId) =>
  (await db.collection(tenantPath("pending_orders")).doc(orderId).get());

/** Runs a full create -> capture for a paid cart, returning both responses. */
async function createAndCapture(email, overrides = {}) {
  const created = await callHttp("create_paypal_order", orderBody({
    email, shippingRate: 8.5, cartItems: [BOOK], ...overrides,
  }));
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.free, false);
  const captured = await callHttp("capture_paypal_order", {
    orderId: created.body.orderId,
    payerID: "FAKEPAYER01",
  });
  return {created, captured, orderId: created.body.orderId};
}

before(async () => {
  await preflight();
  await preflightFakeVendors();
  reseed();
  db = getDb();
  await assertTokenCacheIsCold();
});

/**
 * Several tests below can only observe PayPal auth if the function instance
 * is NOT already holding a live access token. Normally it is not: the fake
 * issues 60-second tokens, which library-paypal.ts caches for
 * (expires_in - 60) = 0 seconds, so every call re-exchanges.
 *
 * But that cache lives in the warm function instance and there is no way to
 * evict it from out here. An emulator left running from before this fake
 * existed - or from a run that died inside the token-cache test at the end of
 * this file, after it raised the lifetime and before it restored it - can be
 * holding a 9-hour token. Every auth assertion then fails saying PayPal was
 * never called, which reads as a product bug and is not one.
 *
 * So probe for it once, up front, and fail with the actual instruction.
 */
async function assertTokenCacheIsCold() {
  await fakeVendors.reset();
  const res = await callHttp("create_paypal_order", orderBody({
    email: "token-probe@vendor.test", cartItems: [BOOK],
  }));
  if (res.status !== 200) {
    throw new Error(
      "Probe checkout failed (" + res.status + "): " +
      JSON.stringify(res.body) + " - the paid path is not reachable at all. " +
      "Check that the config fixture seeded and fake-vendors is up."
    );
  }
  const exchanged = (await fakeVendors.log("paypal"))
    .some((r) => r.op === "oauth");
  if (!exchanged) {
    throw new Error(
      "The functions emulator is holding a long-lived PayPal access token, " +
      "so this suite cannot observe the token exchange. Restart the " +
      "emulator (npm run emu) and re-run. Cause: a previous run issued a " +
      "9-hour token - either from before scripts/fake-vendors.js defaulted " +
      "oauthExpiresIn to 60, or from a run that died inside the token-cache " +
      "test before it restored the short lifetime."
    );
  }
}

// Every test starts from the fake's defaults. Scenario state is process-wide
// on the fake, so a test that forgot to clean up would poison the next one -
// reset here rather than trusting each test to undo itself.
beforeEach(async () => {
  await fakeVendors.reset();
});

// ---------------------------------------------------------------------------
// The happy path - reachable for the first time
// ---------------------------------------------------------------------------

test("a paid order reaches PayPal, and the order we send it is priced " +
  "entirely from Firestore", async () => {
  const email = "paid-create@vendor.test";
  const res = await callHttp("create_paypal_order", orderBody({
    email,
    shippingRate: 8.5,
    shippingAddress: gaAddress("30301"),
    cartItems: [BOOK],
  }));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.free, false);
  assert.match(res.body.orderId, /^FAKEORDER/);

  // 2 x $20 = 40 subtotal; Georgia tax at the fake's 8.9% = 3.56;
  // plus the 8.50 client-quoted shipping rate = 52.06.
  assert.deepEqual(res.body.breakdown, {
    subtotal: 40,
    totalDiscount: 0,
    estimatedTaxes: 3.56,
    taxRate: 0.089,
    taxSource: "service",
    shippingDiscount: 0,
    shippingDiscountReason: "",
    total: 52.06,
  });

  // What actually crossed the wire to PayPal. Worth asserting separately
  // from the breakdown above: the response is what the BROWSER is told, and
  // the two disagreeing is precisely the bug class server-side pricing
  // exists to prevent.
  const [create] = (await fakeVendors.log("paypal"))
    .filter((r) => r.op === "create_order");
  assert.equal(create.intent, "CAPTURE");
  assert.equal(create.amount, "52.06");
  assert.equal(create.breakdown.item_total.value, "40.00");
  assert.equal(create.breakdown.tax_total.value, "3.56");
  assert.equal(create.breakdown.shipping.value, "8.50");
  assert.equal(create.items[0].name, "Disciple-Making Field Guide");
  assert.equal(create.items[0].unit_amount.value, "20.00");

  // Staged, not sold: no Purchase exists until money is actually captured.
  assert.equal((await purchasesByEmail(email)).length, 0);
  const pending = await pendingOrder(res.body.orderId);
  assert.equal(pending.exists, true);
  assert.equal(pending.data().status, "created");
  assert.equal(pending.data().amount, "52.06");
});

test("the web storefront authenticates with ITS OWN PayPal app, not the " +
  "library app's", async () => {
  // Two different PayPal apps authenticate through the same module. Handing
  // one app's credentials to the other's API calls is a real failure mode
  // library-paypal.ts warns about at length, and it is invisible from
  // Firestore - the only place it shows is the token exchange.
  //
  // That exchange is only observable because the fake issues 60-second
  // tokens by default, which library-paypal.ts caches for (expires_in - 60)
  // = 0 seconds. With a realistic 9-hour token the first checkout of the run
  // caches one and nothing else ever reaches the vendor - see oauthExpiresIn
  // in scripts/fake-vendors.js, and the token-cache test at the end of this
  // file which raises it deliberately.
  await callHttp("create_paypal_order", orderBody({
    email: "clientid@vendor.test", shippingRate: 1, cartItems: [BOOK],
  }));
  const oauth = (await fakeVendors.log("paypal"))
    .filter((r) => r.op === "oauth");
  assert.ok(oauth.length >= 1, "expected a token exchange");
  // The storefront's client id comes from Firestore config, not the
  // hardcoded library ids in library-paypal.ts.
  assert.equal(oauth[0].clientId, "FAKE-EMULATOR-PAYPAL-CLIENT-ID");
  assert.equal(oauth[0].hasSecret, true);
});

test("capturing writes the Purchase, finalizes the pending order and " +
  "queues the receipt email", async () => {
  const email = "paid-capture@vendor.test";
  const {captured, orderId} = await createAndCapture(email);

  assert.equal(captured.status, 200, JSON.stringify(captured.body));
  const form = captured.body.checkoutForm;
  assert.ok(form.id, "capture response should carry the new purchase id");
  assert.equal(form.receipt, orderId);
  assert.equal(form.payPalReceipt.status, "COMPLETED");
  assert.equal(form.payPalReceipt.payerID, "FAKEPAYER01");

  const purchases = await purchasesByEmail(email);
  assert.equal(purchases.length, 1);
  const purchase = purchases[0].data();
  assert.equal(purchase.receipt, orderId);
  assert.equal(purchase.source, "web");
  // Pricing on the stored doc is the SERVER's, not anything the client sent.
  assert.equal(purchase.total, 40);
  assert.equal(purchase.shippingRate, 8.5);

  const pending = await pendingOrder(orderId);
  assert.equal(pending.data().status, "captured");
  assert.equal(pending.data().purchaseId, purchases[0].id);

  // The receipt is queued through the `mail` collection (the Trigger Email
  // extension's inbox), which is inert in the emulator - so this asserts the
  // queueing, which is the part this code owns.
  const mail = await db.collection("mail").get();
  const toBuyer = mail.docs.filter((d) => {
    const to = d.data().to;
    return Array.isArray(to) ? to.includes(email) : to === email;
  });
  assert.ok(toBuyer.length >= 1, "expected a receipt email queued to the buyer");
});

// ---------------------------------------------------------------------------
// Refusals. These are the assertions that actually matter.
// ---------------------------------------------------------------------------

test("a capture whose AMOUNT does not match the order is refused and " +
  "writes no Purchase", async () => {
  // capture_paypal_order calls this defense in depth: PayPal order amounts
  // cannot change after creation without re-approval, so this should never
  // fire - which is exactly why it has to be tested deliberately rather than
  // waited for. Until now nothing proved the check worked at all.
  const email = "amount-mismatch@vendor.test";
  await fakeVendors.control({captureAmountOverride: "1.00"});

  const {captured, orderId} = await createAndCapture(email);

  assert.equal(captured.status, 400);
  assert.deepEqual(captured.body, {
    code: 400, error: "Payment capture could not be verified",
  });
  assert.equal((await purchasesByEmail(email)).length, 0);
  // The pending order stays "created" - not captured, not half-written.
  assert.equal((await pendingOrder(orderId)).data().status, "created");
});

test("a capture PayPal did not COMPLETE is refused and writes no Purchase",
  async () => {
    const email = "not-completed@vendor.test";
    await fakeVendors.control({captureOrderStatus: "PENDING"});

    const {captured, orderId} = await createAndCapture(email);

    assert.equal(captured.status, 400);
    assert.equal(captured.body.error, "Payment capture could not be verified");
    assert.equal((await purchasesByEmail(email)).length, 0);
    assert.equal((await pendingOrder(orderId)).data().status, "created");
  });

test("a DECLINED capture (HTTP failure) is refused and writes no Purchase",
  async () => {
    const email = "declined@vendor.test";
    await fakeVendors.control({captureStatus: 422});

    const {captured, orderId} = await createAndCapture(email);

    assert.equal(captured.status, 400);
    assert.equal(captured.body.error, "Payment capture could not be verified");
    assert.equal((await purchasesByEmail(email)).length, 0);
    assert.equal((await pendingOrder(orderId)).data().status, "created");
  });

test("capturing an unknown orderId is refused before PayPal is called at all",
  async () => {
    const res = await callHttp("capture_paypal_order", {
      orderId: "NO-SUCH-ORDER", payerID: "x",
    });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {code: 400, error: "Unknown orderId"});
    // The pending_orders lookup happens first, so nothing should have gone
    // to the vendor - a fabricated order id must not even cost a round trip.
    const captures = (await fakeVendors.log("paypal"))
      .filter((r) => r.op === "capture");
    assert.equal(captures.length, 0);
  });

test("capture_paypal_order requires an orderId", async () => {
  const res = await callHttp("capture_paypal_order", {payerID: "x"});
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, {code: 400, error: "orderId is required"});
});

test("a REPLAYED capture returns the same purchase and never captures twice",
  async () => {
    // The real trigger is a double-click or a retry. Without the replay
    // guard this double-captures at PayPal and writes two Purchase docs for
    // one payment.
    const email = "replay@vendor.test";
    const {captured, orderId} = await createAndCapture(email);
    assert.equal(captured.status, 200);
    const firstId = captured.body.checkoutForm.id;

    const again = await callHttp("capture_paypal_order", {
      orderId, payerID: "FAKEPAYER01",
    });
    assert.equal(again.status, 200);
    assert.equal(again.body.checkoutForm.id, firstId);

    assert.equal((await purchasesByEmail(email)).length, 1);
    // The guard returns before the vendor call, so PayPal saw exactly one
    // capture attempt for this order.
    const captures = (await fakeVendors.log("paypal"))
      .filter((r) => r.op === "capture" && r.orderId === orderId);
    assert.equal(captures.length, 1);
  });

test("a PayPal order-creation failure fails clean - nothing staged, no " +
  "Purchase", async () => {
  const email = "create-fails@vendor.test";
  await fakeVendors.control({createOrderStatus: 422});

  const res = await callHttp("create_paypal_order", orderBody({
    email, shippingRate: 8.5, cartItems: [BOOK],
  }));

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, {
    code: 400, error: "Failed to create PayPal order",
  });
  assert.equal((await purchasesByEmail(email)).length, 0);
  const staged = await db.collection(tenantPath("pending_orders"))
    .where("checkoutForm.email", "==", email).get();
  assert.equal(staged.size, 0);
});

test("a 200 from PayPal with no order id is treated as a failure", async () => {
  // The other branch of the same guard, and the more dangerous one: a
  // truthy-looking response that carries nothing to capture against later.
  const email = "no-order-id@vendor.test";
  await fakeVendors.control({createOrderOmitId: true});

  const res = await callHttp("create_paypal_order", orderBody({
    email, shippingRate: 8.5, cartItems: [BOOK],
  }));

  assert.equal(res.status, 400);
  assert.equal(res.body.error, "Failed to create PayPal order");
  assert.equal((await purchasesByEmail(email)).length, 0);
});

test("a PayPal credential failure fails clean at checkout start", async () => {
  // Reachable only because tokens are not cached by default here (see the
  // note on the storefront-credentials test above). A cached token would
  // sail straight past a vendor that has started rejecting our credentials.
  const email = "bad-credentials@vendor.test";
  await fakeVendors.control({oauthStatus: 401});

  const res = await callHttp("create_paypal_order", orderBody({
    email, shippingRate: 8.5, cartItems: [BOOK],
  }));

  // The token exchange throws with the three-way diagnostic; the outer catch
  // turns it into the generic message the shopper sees.
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, {code: 400, error: "Unable to start checkout"});
  assert.equal((await purchasesByEmail(email)).length, 0);
});

// ---------------------------------------------------------------------------
// Georgia tax - a whole branch that no test had ever entered
// ---------------------------------------------------------------------------

test("Georgia: the live service rate is used, and taxed on items only", () =>
  (async () => {
    const res = await callHttp("create_paypal_order", orderBody({
      email: "tax-service@vendor.test",
      shippingRate: 8.5,
      shippingAddress: gaAddress("30301"),
      cartItems: [BOOK],
    }));
    assert.equal(res.status, 200);
    assert.equal(res.body.breakdown.taxRate, 0.089);
    assert.equal(res.body.breakdown.taxSource, "service");
    // 40 * 0.089 = 3.56 - shipping is NOT in the taxable amount.
    assert.equal(res.body.breakdown.estimatedTaxes, 3.56);
  })());

test("Georgia: a tax-service 500 falls back to the 7% default", async () => {
  const res = await callHttp("create_paypal_order", orderBody({
    email: "tax-500@vendor.test",
    shippingRate: 8.5,
    shippingAddress: gaAddress("30302"),
    cartItems: [BOOK],
  }));
  assert.equal(res.status, 200);
  assert.equal(res.body.breakdown.taxRate, 0.07);
  assert.equal(res.body.breakdown.taxSource, "default");
  assert.equal(res.body.breakdown.estimatedTaxes, 2.8);
});

test("Georgia: a 200 with no numeric rate also falls back to the default",
  async () => {
    // A separate branch from the 500 above: the request succeeded, the body
    // just did not contain what we need. Silently trusting it would have
    // produced NaN tax.
    const res = await callHttp("create_paypal_order", orderBody({
      email: "tax-malformed@vendor.test",
      shippingRate: 0,
      shippingAddress: gaAddress("30304"),
      cartItems: [BOOK],
    }));
    assert.equal(res.status, 200);
    assert.equal(res.body.breakdown.taxRate, 0.07);
    assert.equal(res.body.breakdown.taxSource, "default");
  });

test("Georgia: a hanging tax service is abandoned after the timeout, and " +
  "checkout still completes", async () => {
  // The timeout exists so a slow apilayer cannot hold up the PayPal buttons
  // for every Georgia shopper. The fake holds the connection open for 6s;
  // TAX_LOOKUP_TIMEOUT_MS is 3s.
  const started = Date.now();
  const res = await callHttp("create_paypal_order", orderBody({
    email: "tax-hang@vendor.test",
    shippingRate: 0,
    shippingAddress: gaAddress("30303"),
    cartItems: [BOOK],
  }));
  const elapsed = Date.now() - started;

  assert.equal(res.status, 200);
  assert.equal(res.body.breakdown.taxSource, "default");
  assert.equal(res.body.breakdown.taxRate, 0.07);
  // Abandoned near the 3s timeout, NOT waited out to the fake's 6s.
  assert.ok(elapsed < 5500, `checkout took ${elapsed}ms - timeout not applied`);
});

test("a successful rate is cached per zip; a fallback is NOT", async () => {
  // Caching a fallback would pin 7% for 12 hours after a momentary blip,
  // which is why only successful lookups are cached. Both halves are pinned
  // here because only the negative half is a bug if it regresses.
  //
  // The zip has to be unique PER RUN. The rate cache lives in the warm
  // function instance and holds for 12 hours, so any fixed zip is already
  // cached the second time this file runs against the same emulator - and
  // the test then fails claiming the cache does not work, which is the exact
  // opposite of the truth. Unmapped GA zips fall through to the fake's
  // default rate, which is a cacheable success just like a mapped one.
  const cachedZip = "31" + String(Date.now() % 1000).padStart(3, "0");
  for (let i = 0; i < 2; i++) {
    await callHttp("create_paypal_order", orderBody({
      email: `tax-cache-${i}@vendor.test`,
      shippingAddress: gaAddress(cachedZip),
      cartItems: [BOOK],
    }));
  }
  let lookups = (await fakeVendors.log("tax"))
    .filter((r) => r.zip === cachedZip);
  assert.equal(lookups.length, 1, "a successful rate should be cached");

  for (let i = 0; i < 2; i++) {
    await callHttp("create_paypal_order", orderBody({
      email: `tax-nocache-${i}@vendor.test`,
      shippingAddress: gaAddress("30302"),
      cartItems: [BOOK],
    }));
  }
  lookups = (await fakeVendors.log("tax")).filter((r) => r.zip === "30302");
  assert.equal(lookups.length, 2, "a fallback must NOT be cached");
});

test("outside Georgia the tax service is never called at all", async () => {
  const res = await callHttp("create_paypal_order", orderBody({
    email: "tax-texas@vendor.test",
    shippingRate: 8.5,
    cartItems: [BOOK],
  }));
  assert.equal(res.status, 200);
  assert.equal(res.body.breakdown.estimatedTaxes, 0);
  assert.equal(res.body.breakdown.taxSource, "none");
  assert.equal((await fakeVendors.log("tax")).length, 0);
});

test("a free order is never priced for tax or shipping, and no PayPal " +
  "order is created", async () => {
  // A free order is decided BEFORE tax and shipping are computed - that
  // ordering is what stops a $0 order from acquiring tax on top of being
  // free, and it saves a live tax lookup on every free order.
  const email = "free-skips-vendors@vendor.test";
  const res = await callHttp("create_paypal_order", orderBody({
    email,
    couponCode: "FREE100",
    shippingRate: 12.34,
    shippingAddress: gaAddress("30301"),
    cartItems: [BOOK],
  }));

  assert.equal(res.status, 200);
  assert.equal(res.body.free, true);
  assert.equal(res.body.checkoutForm.taxSource, "none");
  assert.equal(res.body.checkoutForm.shippingRate, 0);
  assert.equal((await fakeVendors.log("tax")).length, 0);

  const paypal = await fakeVendors.log("paypal");
  // No ORDER is created - that is the part that matters.
  assert.equal(paypal.filter((r) => r.op === "create_order").length, 0);
  // But the token exchange DOES happen, and that is deliberate rather than a
  // leak: paypal.functions.ts starts the token fetch concurrently with
  // pricing to keep it off the paid path's critical latency, and its own
  // comment accepts that "free/$0 orders resolve a token they don't use".
  // Pinned so the tradeoff is visible if anyone revisits it - on a warm
  // instance with a realistic token lifetime this costs nothing at all.
  assert.equal(paypal.filter((r) => r.op === "oauth").length, 1);

  assert.equal((await purchasesByEmail(email)).length, 1);
});

// ---------------------------------------------------------------------------
// The token cache itself
// ---------------------------------------------------------------------------

test("a PayPal access token is cached until it expires, then re-exchanged",
  async () => {
    // The lifetime here is chosen so the test CLEANS UP AFTER ITSELF.
    //
    // A cached token cannot be evicted from outside the function instance:
    // once a 9-hour token is in there, every later call reuses it and no
    // amount of reconfiguring the fake can force a fresh exchange. A first
    // attempt at this test raised the lifetime to 9 hours and then tried to
    // "restore" a short one by making another call - which quietly did
    // nothing, because that call reused the very token it was meant to
    // replace, and poisoned every auth assertion in the file on the next run.
    //
    // 62 seconds gives (expires_in - 60) = a 2-second TTL: long enough to
    // prove the token is reused, short enough that it has expired again
    // before this file is done. Both halves of the cache's contract get
    // covered and nothing is left behind.
    await fakeVendors.control({oauthExpiresIn: 62});

    // First call exchanges and caches.
    await callHttp("create_paypal_order", orderBody({
      email: "token-cache-warm@vendor.test", cartItems: [BOOK],
    }));

    // Immediately after, the token is live and must be reused.
    await fakeVendors.reset();
    await fakeVendors.control({oauthExpiresIn: 62});
    await callHttp("create_paypal_order", orderBody({
      email: "token-cache-hit@vendor.test", cartItems: [BOOK],
    }));
    assert.equal(
      (await fakeVendors.log("paypal")).filter((r) => r.op === "oauth").length,
      0,
      "a live token should be reused, not re-exchanged"
    );

    // Once it lapses, the next checkout must go and get a new one rather
    // than sending PayPal an expired bearer token.
    await new Promise((r) => setTimeout(r, 2500));
    await fakeVendors.reset();
    await callHttp("create_paypal_order", orderBody({
      email: "token-cache-expired@vendor.test", cartItems: [BOOK],
    }));
    assert.equal(
      (await fakeVendors.log("paypal")).filter((r) => r.op === "oauth").length,
      1,
      "an expired token should be re-exchanged"
    );
  });
