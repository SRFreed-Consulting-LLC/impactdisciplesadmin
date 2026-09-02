const {tenantPath} = require("../scripts/lib/tenancy");
// Integration: server-side checkout pricing through the REAL
// create_paypal_order Cloud Function (paypal.functions.ts +
// utils/checkout-pricing.functions.ts) in the emulator.
// Charter area: Store / money math - the server recomputes every price
// from Firestore and ignores whatever the client claims.
//
// The paid path used to be UNOBSERVABLE here. The fixture world had no
// `config` document, so create_paypal_order threw at getPaypalClientId()
// before any network call and every paid test could assert only a generic
// 400 - the real pricing was described in a comment and checked by nobody.
// Since 2026-08-26 the fixtures seed `config` and PayPal is redirected at
// scripts/fake-vendors.js, so those tests assert the actual total instead.
// The paid path's own behaviour (capture, refusals, tax) has its own suite:
// integration/vendor-money.test.js. This file stays focused on the MATH.
// - Discounts come from CAMPAIGN OFFERS now (Campaign Manager v3); the
//   sitewide `sales` collection is retired. So a product is only on sale
//   while some campaign_offer names it, its series, or - for an event -
//   the event itself. The "a discount always beats a coupon" precedence
//   survives the change and is pinned below, but it now has to be set up
//   per test rather than being ambient in the fixture world.
const {test, before} = require("node:test");
const assert = require("node:assert/strict");
const {getDb, preflight, reseed, callHttp, waitFor} = require("./helpers/emulator");

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
  const aff = await db.collection(tenantPath("affilliate_sales"))
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
  const camp = await db.collection(tenantPath("campaigns")).doc("camp-live").get();
  assert.equal(camp.data().stats.purchases, 1);
  assert.equal(camp.data().stats.revenue, 0); // $0 order bumps no revenue

  const events = await db.collection(tenantPath("campaign_events"))
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
  const aff = await db.collection(tenantPath("affilliate_sales")).get();
  assert.ok(aff.docs.every((d) =>
    d.data().code !== "NO-SUCH-CODE" && d.data().code !== "OLDCODE"));
});

test("SAVE10 discounts a paid cart server-side, and nothing is sold until " +
  "the payment is actually captured",
async () => {
  const email = "paid-buyer@money.test";
  const res = await callHttp("create_paypal_order", orderBody({
    email,
    couponCode: "SAVE10",
    shippingRate: 8.5,
    cartItems: [{id: "prod-book-physical", orderQuantity: 2}],
  }));

  // 2 x $20 = 40 subtotal; SAVE10 takes 10% off = 4; plus the 8.50
  // client-quoted shipping rate = 44.50. This used to be a comment - the
  // test could only see a 400 - and so the numbers went unchecked.
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.free, false);
  assert.equal(res.body.breakdown.subtotal, 40);
  assert.equal(res.body.breakdown.totalDiscount, 4);
  assert.equal(res.body.breakdown.total, 44.5);

  // The important half: creating a PayPal order sells nothing. No purchase,
  // and no affiliate credit, until capture_paypal_order confirms the money
  // (see vendor-money.test.js). What DOES exist now is the staged
  // pending_order - which only appears once PayPal has accepted the order.
  assert.equal((await purchasesByEmail(email)).length, 0);
  const pending = await db.collection(tenantPath("pending_orders"))
    .doc(res.body.orderId).get();
  assert.equal(pending.exists, true);
  assert.equal(pending.data().status, "created");
  assert.equal(pending.data().amount, "44.50");
  const aff = await db.collection(tenantPath("affilliate_sales"))
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
  "FREE100 CANNOT zero it - the order stays paid",
async () => {
  // The precedence rule that outlived the sales collection: a coupon only
  // ever discounts an item that is not already discounted. computeOrderPricing
  // enforces it server-side, which is the only place it counts.
  //
  // The offer is created and removed HERE rather than seeded, so it cannot
  // change the pricing every other test in this file depends on.
  const email = "offer-wins@money.test";
  const offerRef = db.collection(tenantPath("campaign_offers")).doc("camp-money-test");

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
    // coupon is refused on an already-discounted line, so the order is a
    // real $15 charge. The 15 is the whole point of the test and used to be
    // invisible - the assertion was only that SOMETHING went wrong at the
    // vendor, which a mispriced order would have satisfied just as well.
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.free, false);
    assert.equal(res.body.breakdown.subtotal, 15);
    assert.equal(res.body.breakdown.total, 15);
    assert.equal(res.body.breakdown.totalDiscount, 0);
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
  const offerRef = db.collection(tenantPath("campaign_offers")).doc("camp-gated-test");

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

test("an INACTIVE product is REFUSED - a delisted item cannot be bought " +
  "with a stale cart or a kept link", async () => {
  // History worth keeping, because the test told the opposite story twice.
  // Originally this asserted a 400 and read as though something stopped the
  // sale - but that 400 was only the emulator's PayPal boundary. Once the
  // fake vendors removed that boundary the same request succeeded and the
  // gap was plain: prod-inactive (isActive:false, cost 99) priced normally
  // and got a payable PayPal order. The storefront filters isActive on its
  // LISTING query, and a filter on a list is not a boundary - the cart
  // addresses items by id.
  //
  // Now refused server-side (utils/sellable.ts), where money moves.
  const email = "inactive-buyer@money.test";
  const res = await callHttp("create_paypal_order", orderBody({
    email,
    cartItems: [{id: "prod-inactive", orderQuantity: 1}],
  }));

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, {code: 400, error: "Unable to start checkout"});
  assert.equal((await purchasesByEmail(email)).length, 0);
  // Scoped to THIS buyer, not the whole collection: earlier tests in this
  // file now legitimately reach PayPal and stage their own pending orders.
  const staged = await db.collection(tenantPath("pending_orders"))
    .where("checkoutForm.email", "==", email).get();
  assert.equal(staged.size, 0);
});

test("an inactive product poisons the WHOLE cart, active items included",
  async () => {
    // Partial fulfilment would be worse than refusal: charging for the good
    // half of a cart and silently dropping the rest is how a customer ends up
    // paying for something they did not receive a record of.
    const email = "mixed-cart@money.test";
    const res = await callHttp("create_paypal_order", orderBody({
      email,
      cartItems: [
        {id: "prod-book-physical", orderQuantity: 1},
        {id: "prod-inactive", orderQuantity: 1},
      ],
    }));

    assert.equal(res.status, 400);
    assert.equal((await purchasesByEmail(email)).length, 0);
  });

test("an ACTIVE event still sells - the event rule is deliberately not the " +
  "product rule", async () => {
  // Guards the other direction. Events use a permissive rule
  // (isActive !== false, plus an earlyRegistration escape hatch) because a
  // summit can legitimately take paid sign-ups before it is public. Applying
  // the strict product rule here would have broken exactly the flow the
  // early-bird campaign offer exists to serve, and it would have broken it
  // silently, at the till.
  const email = "active-event@money.test";
  const res = await callHttp("create_paypal_order", orderBody({
    email,
    couponCode: "FREE100",
    cartItems: [{id: "event-workshop", isEvent: true, orderQuantity: 1}],
  }));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.free, true);
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

// ------------------------------------------ follow-up email: server-derived
//
// Which follow-up template a purchase sends is a property of the PRODUCT,
// chosen by an admin - not a field the buyer gets a say in. Until 2026-08-27
// `followUpEmailId` sat on PricingCartItemInput and rode through
// computeOrderPricing's `...input` spread, so any checkout request could
// name any mail_templates doc id and be mailed that template. Combined with
// the $0 products in the real store (total <= 0 skips PayPal entirely) that
// made gated content - a private video link, a download - free to anyone who
// edited one request field. Both directions are pinned here: the client
// cannot ADD a follow-up, and cannot SUPPRESS one either.

test("a client-supplied followUpEmailId is ignored: buying a product whose " +
  "sendFollowUpEmail is false queues no follow-up, however the request " +
  "asks", async () => {
  const email = "hostile-followup@money.test";
  const res = await callHttp("create_paypal_order", orderBody({
    email,
    couponCode: "FREE100",
    cartItems: [{
      id: "prod-book-physical", // fixture: sendFollowUpEmail: false
      orderQuantity: 1,
      // The tamper: a real template id lifted from another product.
      followUpEmailId: "tmpl-followup",
    }],
  }));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.free, true);

  const form = (await db.collection("purchases")
    .doc(res.body.checkoutForm.id).get()).data();
  assert.equal(form.cartItems[0].followUpEmailId, null,
    "the client's template id must not reach the purchase doc");

  // Exactly one mail: the receipt. No follow-up.
  const mail = await db.collection("mail").where("to", "==", email).get();
  assert.equal(mail.size, 1, "only the receipt should be queued");
  assert.equal(mail.docs[0].data().message.subject,
    "Your Impact Disciples receipt");
});

test("the product's own followUpEmailId is used even when the request omits " +
  "it, and a wrong one cannot redirect it", async () => {
  const email = "real-followup@money.test";
  const res = await callHttp("create_paypal_order", orderBody({
    email,
    couponCode: "FREE100",
    cartItems: [{
      id: "prod-followup", // fixture: sendFollowUpEmail -> "tmpl-followup"
      orderQuantity: 1,
      // Neither omitting it nor naming a different template changes what
      // is sent - the product record decides.
      followUpEmailId: "tmpl-amazon-confirm",
    }],
  }));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.free, true);

  const form = (await db.collection("purchases")
    .doc(res.body.checkoutForm.id).get()).data();
  assert.equal(form.cartItems[0].followUpEmailId, "tmpl-followup",
    "the product's template id, not the request's");

  const mail = await db.collection("mail").where("to", "==", email).get();
  const subjects = mail.docs
    .map((d) => d.data().message.subject).sort();
  assert.deepEqual(subjects, [
    "Getting the most from your workbook", // tmpl-followup
    "Your Impact Disciples receipt",
  ], "receipt + the product's own follow-up, and nothing else");

  // Both tag syntaxes resolve. The follow-up path renders with
  // renderMergeTags (not renderPlaceholders) exactly so a template edited in
  // the email BUILDER - whose tag menu writes *|FNAME|* - does not mail the
  // raw tag to a customer, while the legacy {{...}} spellings the existing
  // Quill templates use keep working.
  const followUp = mail.docs.find((d) =>
    d.data().message.subject === "Getting the most from your workbook");
  const html = followUp.data().message.html;
  assert.match(html, /Hi Buyer Test - tips inside\./,
    `both *|FNAME|* and {{lastName}} must substitute; got: ${html}`);
  assert.doesNotMatch(html, /\*\|/, "no merge tag may reach the customer raw");
  assert.doesNotMatch(html, /\{\{/, "no legacy token may reach the customer raw");
});

test("the stored purchase email is NORMALIZED, not the casing typed", async () => {
  // The join key between a purchase and its customer record. A contact's
  // activity feed streams with an exact where("email", "==", customer.email)
  // (contact-details.component.ts), and both customer-upsert triggers look
  // up by trim().toLowerCase() - so a purchase stored as typed simply does
  // not appear under the contact. 355 prod customers had orders missing
  // from their feed this way before 2026-08-27.
  const typed = "MixedCase.Buyer@Money.TEST";
  const res = await callHttp("create_paypal_order", orderBody({
    email: typed,
    couponCode: "FREE100",
    cartItems: [{ id: "event-workshop", isEvent: true, orderQuantity: 1 }],
  }));

  assert.equal(res.status, 200);
  const form = (await db.collection("purchases")
    .doc(res.body.checkoutForm.id).get()).data();
  assert.equal(form.email, typed.toLowerCase(),
    "purchases.email must be stored lowercased");

  // And the customer the upsert trigger creates must be findable by it -
  // the whole point of normalizing at the write.
  await waitFor(async () => {
    const snap = await db.collection(tenantPath("customers"))
      .where("email", "==", typed.toLowerCase()).get();
    return !snap.empty;
  }, {label: "customer created for the normalized address"});
});
