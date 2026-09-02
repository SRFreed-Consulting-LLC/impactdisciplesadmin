const {tenantPath} = require("../scripts/lib/tenancy");
// Integration: a group leader's BULK LICENSE PURCHASE with a coupon, through
// the real purchaseGroupLicenses callable in the emulator.
//
// Charter area: the money path. This callable is server-authoritative on
// purpose - a 2026-08-17 sweep fixed a version that trusted the client's own
// total, so $0.01 could mint 1000 licenses - and adding coupons to it
// (2026-08-26) added a SECOND thing a client could otherwise lie about. The
// client sends a CODE, never a percentage, and everything below proves the
// server re-decides for itself.
//
// The decision rule: a coupon and the quantity-based bulk tier are
// EXCLUSIVE, the better one wins, and a tie goes to bulk
// (chooseLicenseDiscount, unit-tested in the shared submodule and in
// functions/test/group-license-pricing.test.js). Here it is tested end to
// end, against real Firestore state.
//
// Why a 100% coupon carries the success case: it takes the total to exactly
// $0, which is the one path that legitimately needs no payPalOrderId. That
// lets the whole server decision - resolve, compare, price, mint - be proven
// without standing up a PayPal capture. The non-zero arithmetic is covered
// by the unit tests above.
//
// Seeded fixtures used (scripts/fixtures/emulator-fixtures.js):
//   coupons     FREE100 = 100% | SAVE10 = 10% | OLDCODE = 50% but isActive:false
//   tiers       5 books -> 10% | 10 books -> 20%
//   product     prod-book-digital, cost $10, digitalBookId lib-book-0001
const {test, before, beforeEach} = require("node:test");
const assert = require("node:assert/strict");
const {getDb, preflight, reseed, callCallable, signIn} =
  require("./helpers/emulator");

const LEADER = "patron@test.local";
const BOOK = "lib-book-0001";
const GROUP_ID = "e2e-coupon-group";

let db;
let leaderToken;

/** The leader's own group. Not in the shared fixtures because no other suite
 *  needs one, and requireGroupLeader only reads creatorEmail + bookId. */
async function seedGroup() {
  await db.collection(tenantPath("discussionGroups")).doc(GROUP_ID).set({
    title: "Coupon Test Group",
    creatorEmail: LEADER,
    bookId: BOOK,
    status: "open",
    visibility: "public",
  });
}

/** Every license/purchase this suite minted, so each case starts clean and
 *  the idempotency guard in the callable can't make a later case a no-op. */
async function clearPurchases() {
  for (const name of ["groupLicenses", "purchases"]) {
    const snap = await db.collection(name).where("groupId", "==", GROUP_ID).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

const buy = (quantity, couponCode) =>
  callCallable(
    "purchaseGroupLicenses",
    {groupId: GROUP_ID, quantity, ...(couponCode ? {couponCode} : {})},
    leaderToken,
  );

before(async () => {
  await preflight();
  reseed();
  db = getDb();
  await seedGroup();
  leaderToken = await signIn(LEADER);
});

beforeEach(async () => {
  await seedGroup();
  await clearPurchases();
});

test("a 100% coupon beats the bulk tier and buys the licenses for $0", async () => {
  // 3 books earns no tier at all (lowest is 5), so the coupon is the only
  // discount in play: $30 -> $0, and no payPalOrderId is needed.
  const res = await buy(3, "FREE100");

  assert.equal(res.status, 200, JSON.stringify(res.error));
  assert.equal(res.result.discountSource, "coupon");
  assert.equal(res.result.bulkBeatsCoupon, false);
  assert.equal(res.result.licenseIds.length, 3);

  const purchase = await db.collection(tenantPath("purchases")).doc(res.result.purchaseId).get();
  assert.equal(purchase.data().total, 0);
  assert.equal(purchase.data().discountSource, "coupon");
  assert.equal(purchase.data().couponApplied, true);
});

test("the bulk tier wins over a weaker coupon, and says so", async () => {
  // 10 books = the 20% tier, against SAVE10's 10%. Bulk wins, so the total
  // is $100 - 20% = $80, which is NOT zero and therefore needs PayPal. The
  // refusal is the proof: had the coupon been stacked or preferred, the
  // server would have priced it differently.
  const res = await buy(10, "SAVE10");

  assert.equal(res.status, 400);
  assert.match(res.error.message, /payPalOrderId is required/);

  // Nothing was minted on the way to that refusal.
  const licenses = await db.collection(tenantPath("groupLicenses"))
    .where("groupId", "==", GROUP_ID).get();
  assert.equal(licenses.size, 0);
});

test("a coupon that only ties the bulk tier does not beat it", async () => {
  // 10 books = 20%; a 20% coupon must NOT win (ties go to bulk) and must not
  // stack into 40%. $100 - 20% = $80, still needing PayPal.
  await db.collection(tenantPath("coupons")).doc("coupon-tie").set({
    isActive: true, code: "TIE20", percentOff: 20, isAffilliate: false,
  });

  const res = await buy(10, "TIE20");
  assert.equal(res.status, 400);
  assert.match(res.error.message, /payPalOrderId is required/);
});

test("an inactive coupon is refused outright, not silently ignored", async () => {
  const res = await buy(3, "OLDCODE");

  assert.equal(res.status, 400);
  assert.match(res.error.message, /Invalid, inactive or expired coupon code/);
});

test("an EXPIRED coupon is refused", async () => {
  // This used to be the case that documented a gap: the reader Store's
  // verifyAndGrantReaderStorePurchase checked isActive but never expiresAt,
  // so an expired code still discounted a purchase there. Closed 2026-08-27
  // when all four coupon paths moved onto the shared pickActiveCoupon
  // (utils/coupons.ts), which checks code (case-insensitively), isActive and
  // expiry together. Kept because expiry is still worth pinning here.
  await db.collection(tenantPath("coupons")).doc("coupon-past").set({
    isActive: true,
    code: "LASTYEAR",
    percentOff: 100,
    expiresAt: new Date("2020-01-01T00:00:00Z"),
    isAffilliate: false,
  });

  const res = await buy(3, "LASTYEAR");

  assert.equal(res.status, 400);
  assert.match(res.error.message, /Invalid, inactive or expired coupon code/);
  // Critically: it did not fall through and mint 3 free licenses.
  const licenses = await db.collection(tenantPath("groupLicenses"))
    .where("groupId", "==", GROUP_ID).get();
  assert.equal(licenses.size, 0);
});

test("a made-up code is refused rather than treated as no coupon", async () => {
  const res = await buy(3, "NOPE-NOT-REAL");

  assert.equal(res.status, 400);
  assert.match(res.error.message, /Invalid, inactive or expired coupon code/);
});

test("a coupon tagged to other products does not discount this book", async () => {
  // Tag scoping: this coupon names a product that is not the group's book,
  // so it applies to nothing here. It is IGNORED rather than refused (the
  // Store behaves the same way), leaving the purchase at full price - which
  // for 3 books is $30, so PayPal is required.
  await db.collection(tenantPath("coupons")).doc("coupon-elsewhere").set({
    isActive: true,
    code: "OTHERBOOK",
    percentOff: 100,
    tags: [{id: "prod-some-other-thing"}],
    isAffilliate: false,
  });

  const res = await buy(3, "OTHERBOOK");

  // A 100% coupon WOULD have made this $0 and succeeded. That it demands
  // payment is the proof the tag scoping held.
  assert.equal(res.status, 400);
  assert.match(res.error.message, /payPalOrderId is required/);
});

test("no coupon at all still works exactly as before", async () => {
  // Regression guard: the coupon argument is optional and its absence must
  // not change the pre-existing behaviour. 3 books, no tier, no coupon =
  // $30, so PayPal is required.
  const res = await buy(3);

  assert.equal(res.status, 400);
  assert.match(res.error.message, /payPalOrderId is required/);
});
