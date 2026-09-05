const {tenantPath} = require("../scripts/lib/tenancy");
// Integration: the HTTP endpoints in subscriptions/shipping/youtube
// (+ capture_paypal_order's pre-PayPal validation) through the REAL
// functions in the emulator.
// Charter area: public + staff HTTP surface.
//
// Why this file exists (2026-08-21): these seven endpoints had NO test of
// any kind. They were migrated from 1st-gen to 2nd-gen, which cannot be
// done in place - each one has to be DELETED and recreated in every
// project - so "does this endpoint still exist and behave" needed to be
// answerable by something other than clicking around after a deploy.
// create_paypal_order is deliberately not re-covered here; money.test.js
// already drives it hard.
//
// Emulator boundaries these lean on (deliberately):
// - .secret.local holds FAKE vendor values, so anything reaching ShipEngine
//   or the YouTube Data API fails at that boundary. The endpoints that do
//   so are asserted only for WIRING (they respond as an HTTP function
//   rather than 404ing or failing to load) - see the vendor-boundary test
//   at the bottom for why that is still the assertion worth making here.
// - The staff-gated endpoints are fully assertable without any vendor:
//   requireStaffAuth rejects before the vendor call happens.
const {test, before} = require("node:test");
const assert = require("node:assert/strict");
const {getDb, preflight, reseed, callHttp} = require("./helpers/emulator");

let db;

// Fixture world: casey01-06 newsletter, casey04-08 prayer, casey09-12 on
// neither. See scripts/fixtures/emulator-fixtures.js.
const SUBSCRIBED_NEWSLETTER = "casey01@contacts.test";
const NO_LISTS = "casey10@contacts.test";

const customerByEmail = async (email) => {
  const snap = await db.collection(tenantPath("customers"))
    .where("email", "==", email).limit(1).get();
  return snap.empty ? null : snap.docs[0].data();
};

before(async () => {
  await preflight();
  reseed();
  db = getDb();
});

// ---- subscribe_to_email_list --------------------------------------------

test("subscribe flips the flag on an existing customer and reports it as " +
  "a fresh subscribe", async () => {
  const res = await callHttp("subscribe_to_email_list", {
    email: NO_LISTS, firstName: "Casey10", type: "newsletter",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.subscribed, true);
  assert.equal(res.body.alreadySubscribed, false);

  const customer = await customerByEmail(NO_LISTS);
  assert.equal(customer.subscribedToNewsletter, true);
  assert.ok(customer.newsletterSubscribedDate, "stamps the subscribed date");
});

test("subscribing someone already on the list reports alreadySubscribed " +
  "instead of a flat success", async () => {
  // impactdisciples-web's SubscriptionService shows a distinct message off
  // this flag, so it is part of the contract, not an implementation detail.
  const res = await callHttp("subscribe_to_email_list", {
    email: SUBSCRIBED_NEWSLETTER, type: "newsletter",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.subscribed, true);
  assert.equal(res.body.alreadySubscribed, true);
});

test("subscribe normalizes the email before matching", async () => {
  // A padded, mixed-case address must land on the EXISTING customer doc
  // rather than creating a duplicate.
  const countBefore = (await db.collection(tenantPath("customers")).get()).size;
  const res = await callHttp("subscribe_to_email_list", {
    email: `  ${SUBSCRIBED_NEWSLETTER.toUpperCase()}  `, type: "prayer",
  });
  assert.equal(res.status, 200);
  const countAfter = (await db.collection(tenantPath("customers")).get()).size;
  assert.equal(countAfter, countBefore, "no duplicate customer created");

  const customer = await customerByEmail(SUBSCRIBED_NEWSLETTER);
  assert.equal(customer.subscribedToPrayerTeam, true);
});

test("subscribe creates a customer when the email is unknown", async () => {
  const email = "brand-new@contacts.test";
  const res = await callHttp("subscribe_to_email_list", {
    email, firstName: "Brand", lastName: "New", type: "newsletter",
  });
  assert.equal(res.status, 200);

  const customer = await customerByEmail(email);
  assert.ok(customer, "customer doc created");
  assert.equal(customer.subscribedToNewsletter, true);
  assert.equal(customer.firstName, "Brand");
});

test("subscribe rejects an unknown type and a malformed email", async () => {
  const badType = await callHttp("subscribe_to_email_list", {
    email: NO_LISTS, type: "podcast",
  });
  assert.equal(badType.status, 400);
  assert.match(badType.body.error, /Unknown subscription type/);

  const badEmail = await callHttp("subscribe_to_email_list", {
    email: "not-an-email", type: "newsletter",
  });
  assert.equal(badEmail.status, 400);
  assert.match(badEmail.body.error, /Missing or invalid email/);
});

// ---- unsubscribe_from_email_list ----------------------------------------
//
// Links are signed since 2026-09-05 (functions/src/utils/unsubscribe-token):
// the token is an HMAC of address + list under UNSUBSCRIBE_TOKEN_SECRET,
// whose emulator value scripts/write-emulator-env.js writes. A link with no
// token is honoured only until LEGACY_UNSUBSCRIBE_LINKS_UNTIL.
const {
  unsubscribeToken, legacyLinksStillHonoured,
} = require("../functions/lib/utils/unsubscribe-token");
const EMULATOR_UNSUB_SECRET = "fake-unsubscribe-secret";
const unsubLink = (email, type, token) =>
  `unsubscribe_from_email_list?email=${encodeURIComponent(email)}` +
  `&type=${type}&token=${token}`;
const signedLink = (email, type) =>
  unsubLink(email, type, unsubscribeToken(email, type, EMULATOR_UNSUB_SECRET));

test("a signed unsubscribe link clears the flag for the matching customer",
  async () => {
    // GET, the way a mail client opens it - callHttp POSTs.
    const res = await callHttp(signedLink(SUBSCRIBED_NEWSLETTER, "newsletter"),
      {}, {}, "GET");
    assert.equal(res.status, 200);

    const customer = await customerByEmail(SUBSCRIBED_NEWSLETTER);
    assert.equal(customer.subscribedToNewsletter, false);
  });

test("unsubscribe matches a mixed-case address from an email link",
  async () => {
    // Unsubscribe links are generated into sent mail; a mixed-case address
    // in one must not silently no-op - and its token still verifies, since
    // the token is computed over the normalised address.
    const target = "casey05@contacts.test";
    const res = await callHttp(
      signedLink(target.toUpperCase(), "prayer"), {}, {}, "GET");
    assert.equal(res.status, 200);

    const customer = await customerByEmail(target);
    assert.equal(customer.subscribedToPrayerTeam, false);
  });

test("a wrong token unsubscribes nobody", async () => {
  const target = "casey06@contacts.test";
  const forged = unsubscribeToken(target, "newsletter", "not-the-secret");
  const res = await callHttp(unsubLink(target, "newsletter", forged),
    {}, {}, "GET");
  assert.equal(res.status, 403);

  const customer = await customerByEmail(target);
  assert.equal(customer.subscribedToNewsletter, true);
});

test("an untokened link is honoured during the grace period and refused after",
  async () => {
    const target = "casey03@contacts.test";
    const res = await callHttp(
      `unsubscribe_from_email_list?email=${encodeURIComponent(target)}` +
      "&type=newsletter", {}, {}, "GET");
    if (legacyLinksStillHonoured()) {
      assert.equal(res.status, 200);
      assert.equal((await customerByEmail(target)).subscribedToNewsletter,
        false);
    } else {
      assert.equal(res.status, 400);
      assert.equal((await customerByEmail(target)).subscribedToNewsletter,
        true);
    }
  });

test("unsubscribe rejects an unknown type, a missing email and a POST",
  async () => {
    const badType = await callHttp(
      "unsubscribe_from_email_list?email=a%40b.test&type=podcast", {}, {},
      "GET");
    assert.equal(badType.status, 400);

    const noEmail = await callHttp(
      "unsubscribe_from_email_list?type=newsletter", {}, {}, "GET");
    assert.equal(noEmail.status, 400);

    const posted = await callHttp(signedLink("a@b.test", "newsletter"), {});
    assert.equal(posted.status, 405);
  });

// ---- staff gates ---------------------------------------------------------

test("get_shipping_label refuses an unauthenticated caller", async () => {
  // Buying a label spends real postage - this gate is the only thing
  // between the open internet and that.
  const res = await callHttp("get_shipping_label", {shipId: "se-000"});
  assert.equal(res.status, 401);
  assert.equal(res.body.error, "Unauthorized");
});

test("get_youtube_videos refuses an unauthenticated caller", async () => {
  const res = await callHttp("get_youtube_videos", {});
  assert.equal(res.status, 401);
  assert.equal(res.body.error, "Unauthorized");
});

// ---- capture_paypal_order (pre-PayPal validation) ------------------------

test("capture rejects a missing orderId before touching PayPal", async () => {
  const res = await callHttp("capture_paypal_order", {});
  assert.equal(res.status, 400);
  assert.match(res.body.error, /orderId is required/);
});

test("capture rejects an orderId with no staged pending_order", async () => {
  // The staging doc is what makes capture safe to replay; an unknown id
  // must never reach PayPal.
  const res = await callHttp("capture_paypal_order", {
    orderId: "not-a-real-order", payerID: "PAYER1",
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Unknown orderId/);
});

// ---- vendor-boundary wiring ---------------------------------------------

test("the vendor-backed endpoints are wired and reachable", async () => {
  // These two go straight to ShipEngine / the YouTube Data API, which the
  // emulator's fake secrets cannot satisfy - so there is no useful
  // behavioural assertion to make. What IS worth pinning is that each one
  // still EXISTS and runs as an HTTP function: a 404 here means the
  // endpoint was lost (exactly the failure mode a delete-and-recreate
  // generation migration can produce), whereas any other status means the
  // function loaded, bound its secrets, passed CORS and ran its handler.
  for (const name of ["get_shipping_rates", "get_youtube_videos_public"]) {
    const res = await callHttp(name, {});
    assert.notEqual(res.status, 404, `${name} is missing entirely`);
  }
});
