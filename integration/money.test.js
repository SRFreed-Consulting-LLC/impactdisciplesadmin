// Integration: server-side checkout pricing through the REAL
// create_paypal_order Cloud Function (paypal.functions.ts +
// utils/checkout-pricing.functions.ts) in the emulator.
// Charter area: Store / money math - the server recomputes every price
// from Firestore and ignores whatever the client claims.
//
// Emulator boundaries this suite leans on (deliberately):
// - The fixture world has NO `config` document, so the paid path fails
//   deterministically at getPaypalClientId() ("config.paypalClientId is
//   not set") BEFORE any network call - the function's outer catch turns
//   that into 400 "Unable to start checkout". Nothing is staged first
//   (pending_orders is only written AFTER PayPal accepts the order), so
//   paid-path tests can only pin the clean error + the absence of writes.
// - Discounts come from CAMPAIGN OFFERS now (Campaign Manager v3); the
//   sitewide `sales` collection is retired. So a product is only on sale
//   while some campaign_offer names it, its series, or - for an event -
//   the event itself. The "a discount always beats a coupon" precedence
//   survives the change and is pinned below, but it now has to be set up
//   per test rather than being ambient in the fixture world.
const {test, before} = require("node:test");
const assert = require("node:assert/strict");
const {getDb, preflight, reseed, callHttp} = require("./helpers/emulator");

let db;

// Non-Georgia address: keeps the (network-reliant) apilayer tax lookup
// entirely out of these tests - tax only computes for state === "Georgia".
const TX_ADDRESS = {
  address1: "1 Alamo Plz", city: "San Antonio",
  state: "Texas", zip: "78205", country: "US",
};

const orderBody = (overrides) => ({
  firstName: "Buyer",
  lastName: "Test",
  email: "buyer@money.test",
  phone: "555-0000",
  isShippingSameAsBilling: true,
  shippingAddress: TX_ADDRESS,
  shippingRate: 0,
  cartItems: [],
  ...overrides,
});

const purchasesByEmail = async (email) =>
  (await db.collection("purchases").where("email", "==", email).get()).docs;

before(async () => {
  await preflight();
  reseed();
  db = getDb();
});

test("FREE100 on an event zeroes the order server-side; tampered client " +
  "price fields are ignored and the stored purchase carries fixture " +
  "pricing only", async () => {
  const email = "free-buyer@money.test";
  const res = await callHttp("create_paypal_order", orderBody({
    email,
    couponCode: "FREE100",
    // Every one of these is a tamper attempt the server must ignore:
    total: 9999,
    discount: 0,
    estimatedTaxes: 123,
    shippingRate: 12.34, // zeroed on a free order (never charged)
    cartItems: [{
      id: "event-workshop", isEvent: true, orderQuantity: 1,
      price: 0.01, cost: 0.01, total: 0.01, salePrice: 0.01,
    }],
  }));

  assert.equal(res.status, 200);
  assert.equal(res.body.free, true);
  assert.ok(res.body.checkoutForm.id, "free order returns the purchase id");

  const doc = await db.collection("purchases")
    .doc(res.body.checkoutForm.id).get();
  assert.ok(doc.exists);
  const form = doc.data();
  // Server-computed pricing (event-workshop costInDollars = 10):
  assert.equal(form.receipt, "COUPON");
  assert.equal(form.total, 10); // "total" = PRE-discount item subtotal
  assert.equal(form.discount, 10);
  assert.equal(form.couponCode, "FREE100");
  assert.equal(form.couponPercent, 100);
  assert.equal(form.estimatedTaxes, 0);
  assert.equal(form.taxRate, 0);
  assert.equal(form.taxSource, "none");
  assert.equal(form.shippingRate, 0); // client's 12.34 zeroed
  assert.equal(form.shippingDiscount, 0);
  const item = form.cartItems[0];
  // Pinned quirk: computeOrderPricing reads doc.title for the item name,
  // but EVENT docs carry eventName (no title) - so an event cart item is
  // stored with an empty itemName (and would go to PayPal as "Item").
  // Reported, not fixed here.
  assert.equal(item.itemName, "");
  assert.equal(item.price, 10); // fixture price, not the tampered 0.01
  assert.equal(item.salePrice, 0); // events never on sale
  assert.equal(item.discount, 10);
  assert.equal(item.discountPrice, 0);
  assert.equal(item.processedStatus, "NEW");
  assert.equal(item.cost, undefined); // tampered keys dropped by capCartItems
  assert.equal(item.total, undefined);

  // Receipt email queued server-side from the "Sales Receipt" template.
  const mail = await db.collection("mail").where("to", "==", email).get();
  assert.equal(mail.size, 1);
  assert.equal(mail.docs[0].data().message.subject,
    "Your Impact Disciples receipt");

  // Affiliate sale recorded server-side from server-computed numbers.
  const aff = await db.collection("affilliate_sales")
    .where("code", "==", "FREE100").get();
  assert.equal(aff.size, 1);
  assert.equal(aff.docs[0].data().totalBeforeDiscount, 10);
  assert.equal(aff.docs[0].data().totalAfterDiscount, 0);
  assert.equal(aff.docs[0].data().receipt, "COUPON");
});

test("a genuinely $0 order takes the FREE ONLY path and validated " +
  "attribution credits the campaign funnel", async () => {
  const res = await callHttp("create_paypal_order", orderBody({
    email: "attributed@money.test",
    cartItems: [{id: "event-summit-2027", isEvent: true, orderQuantity: 1}],
    attribution: {
      campaignId: "camp-live",
      source: "popup",
      emailId: 999, // non-string - must be dropped by sanitizeAttribution
    },
  }));
  assert.equal(res.status, 200);
  assert.equal(res.body.free, true);

  const doc = await db.collection("purchases")
    .doc(res.body.checkoutForm.id).get();
  const form = doc.data();
  assert.equal(form.receipt, "FREE ONLY"); // no coupon involved
  assert.equal(form.total, 0);
  assert.deepEqual(form.attribution, {campaignId: "camp-live", source: "popup"});

  // recordPurchaseAttribution is awaited before the response - the
  // campaign funnel bump is already visible.
  const camp = await db.collection("campaigns").doc("camp-live").get();
  assert.equal(camp.data().stats.purchases, 1);
  assert.equal(camp.data().stats.revenue, 0); // $0 order bumps no revenue

  const events = await db.collection("campaign_events")
    .where("campaignId", "==", "camp-live")
    .where("type", "==", "purchase").get();
  assert.equal(events.size, 1);
  assert.equal(events.docs[0].data().via, "popup");
});

test("unknown and inactive coupon codes are silently ignored, not " +
  "errors - the order proceeds un-discounted", async () => {
  // Unknown code on a $0 event cart: still succeeds, but as FREE ONLY
  // (no couponCode stored), proving the code was dropped, not applied.
  const unknown = await callHttp("create_paypal_order", orderBody({
    email: "nocoupon@money.test",
    couponCode: "NO-SUCH-CODE",
    cartItems: [{id: "event-summit-2027", isEvent: true, orderQuantity: 1}],
  }));
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.free, true);
  const doc1 = await db.collection("purchases")
    .doc(unknown.body.checkoutForm.id).get();
  assert.equal(doc1.data().receipt, "FREE ONLY");
  assert.equal(doc1.data().couponCode, undefined);
  assert.equal(doc1.data().couponPercent, undefined);

  // Inactive coupon (OLDCODE, isActive:false): same silent-ignore.
  const inactive = await callHttp("create_paypal_order", orderBody({
    email: "oldcoupon@money.test",
    couponCode: "OLDCODE",
    cartItems: [{id: "event-summit-2027", isEvent: true, orderQuantity: 1}],
  }));
  assert.equal(inactive.status, 200);
  assert.equal(inactive.body.free, true);
  const doc2 = await db.collection("purchases")
    .doc(inactive.body.checkoutForm.id).get();
  assert.equal(doc2.data().receipt, "FREE ONLY");
  assert.equal(doc2.data().couponCode, undefined);

  // Neither ignored code produced an affiliate-sale row.
  const aff = await db.collection("affilliate_sales").get();
  assert.ok(aff.docs.every((d) =>
    d.data().code !== "NO-SUCH-CODE" && d.data().code !== "OLDCODE"));
});

test("SAVE10 on a paid cart reaches the PayPal boundary and fails clean " +
  "- nothing staged, no purchase, no pending_order, no affiliate row",
async () => {
  const email = "paid-buyer@money.test";
  const res = await callHttp("create_paypal_order", orderBody({
    email,
    couponCode: "SAVE10",
    shippingRate: 8.5,
    cartItems: [{id: "prod-book-physical", orderQuantity: 2}],
  }));
  // Server math it computed before the boundary (not observable in any
  // doc, documented here): sale price 20 - 25% = 15/each; SAVE10 skipped
  // because the sale wins; subtotal 30; total 30 + 8.50 shipping = 38.50.
  // The paid path then dies at the vendor boundary (no config.
  // paypalClientId in the emulator world) -> generic 400.
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, {code: 400, error: "Unable to start checkout"});

  assert.equal((await purchasesByEmail(email)).length, 0);
  const pending = await db.collection("pending_orders").get();
  assert.equal(pending.size, 0); // staged only AFTER PayPal accepts
  const aff = await db.collection("affilliate_sales")
    .where("code", "==", "SAVE10").get();
  assert.equal(aff.size, 0);
});

test("with NO campaign offer, FREE100 zeroes a product and the order " +
  "completes free - the path the retired sitewide sale used to block",
async () => {
  // Worth having as its own test: while the old "Summer Sale" existed it
  // applied to every product in the world, so this was impossible and the
  // only coupon-to-zero path was an event. Retiring sales opened it.
  const email = "coupon-zeroes@money.test";
  const res = await callHttp("create_paypal_order", orderBody({
    email,
    couponCode: "FREE100",
    cartItems: [{id: "prod-book-physical", orderQuantity: 1}],
  }));

  assert.equal(res.status, 200);
  assert.equal(res.body.free, true);
  assert.equal((await purchasesByEmail(email)).length, 1);
});

test("a campaign offer beats a coupon: while an offer names the product, " +
  "FREE100 CANNOT zero it - the order stays paid and hits the boundary",
async () => {
  // The precedence rule that outlived the sales collection: a coupon only
  // ever discounts an item that is not already discounted. computeOrderPricing
  // enforces it server-side, which is the only place it counts.
  //
  // The offer is created and removed HERE rather than seeded, so it cannot
  // change the pricing every other test in this file depends on.
  const email = "offer-wins@money.test";
  const offerRef = db.collection("campaign_offers").doc("camp-money-test");

  await offerRef.set({
    campaignId: "camp-money-test",
    target: {kind: "product", id: "prod-book-physical"},
    discount: {type: "percentOff", value: 25},
    freeShipping: false,
    isActive: true,
    startsAt: null,
    endsAt: null,
    requiresAttribution: false,
  });

  try {
    const res = await callHttp("create_paypal_order", orderBody({
      email,
      couponCode: "FREE100",
      cartItems: [{id: "prod-book-physical", orderQuantity: 1}],
    }));

    // NOT {free:true}: the offer puts the item on sale (20 -> 15) and the
    // coupon is refused on an already-discounted line, so itemsTotal is 15,
    // the paid path runs, and the emulator's vendor boundary 400s it.
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "Unable to start checkout");
    assert.equal((await purchasesByEmail(email)).length, 0);
  } finally {
    await offerRef.delete();
  }
});

test("an offer that requires attribution is refused to a buyer who did " +
  "not arrive through the campaign", async () => {
  // The early-bird rule, enforced where money changes hands rather than only
  // in the storefront. Without attribution the buyer pays full price, so
  // FREE100 still zeroes the line and the order completes free.
  const email = "unattributed@money.test";
  const offerRef = db.collection("campaign_offers").doc("camp-gated-test");

  await offerRef.set({
    campaignId: "camp-gated-test",
    target: {kind: "product", id: "prod-book-physical"},
    discount: {type: "percentOff", value: 25},
    freeShipping: false,
    isActive: true,
    startsAt: null,
    endsAt: null,
    requiresAttribution: true,
  });

  try {
    const res = await callHttp("create_paypal_order", orderBody({
      email,
      couponCode: "FREE100",
      cartItems: [{id: "prod-book-physical", orderQuantity: 1}],
    }));

    assert.equal(res.status, 200);
    assert.equal(res.body.free, true);
  } finally {
    await offerRef.delete();
  }
});

test("an INACTIVE product is not rejected - it prices normally and " +
  "proceeds to the paid path (no server-side isActive check)", async () => {
  const email = "inactive-buyer@money.test";
  const res = await callHttp("create_paypal_order", orderBody({
    email,
    cartItems: [{id: "prod-inactive", orderQuantity: 1}],
  }));
  // prod-inactive (isActive:false, cost 99) is priced like any other
  // product and heads for PayPal - the emulator boundary is what stops it,
  // not an inactive-product guard. Pinned as-is; flagged in the suite report
  // as a gap worth a look.
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "Unable to start checkout");
  assert.equal((await purchasesByEmail(email)).length, 0);
});

test("input validation: empty cart, missing email/address, unknown " +
  "product, and non-positive quantities are all rejected", async () => {
  const noCart = await callHttp("create_paypal_order",
    orderBody({cartItems: []}));
  assert.equal(noCart.status, 400);
  assert.equal(noCart.body.error, "cartItems is required");

  const noEmail = await callHttp("create_paypal_order", orderBody({
    email: undefined,
    cartItems: [{id: "event-workshop", isEvent: true, orderQuantity: 1}],
  }));
  assert.equal(noEmail.status, 400);
  assert.equal(noEmail.body.error, "email and shippingAddress are required");

  const unknownProduct = await callHttp("create_paypal_order", orderBody({
    email: "ghost@money.test",
    cartItems: [{id: "prod-nope", orderQuantity: 1}],
  }));
  assert.equal(unknownProduct.status, 400);
  assert.equal(unknownProduct.body.error, "Unable to start checkout");

  // The free-purchase exploit guard: a zero/negative quantity must die in
  // validation, never collapse the total to 0 and mint a free purchase.
  for (const orderQuantity of [0, -1, 1.5, "2"]) {
    const bad = await callHttp("create_paypal_order", orderBody({
      email: "qty@money.test",
      couponCode: "FREE100",
      cartItems: [{id: "event-workshop", isEvent: true, orderQuantity}],
    }));
    assert.equal(bad.status, 400,
      `orderQuantity ${JSON.stringify(orderQuantity)} must be rejected`);
    assert.equal(bad.body.error, "Unable to start checkout");
  }
  assert.equal((await purchasesByEmail("qty@money.test")).length, 0);
  assert.equal((await purchasesByEmail("ghost@money.test")).length, 0);
});
