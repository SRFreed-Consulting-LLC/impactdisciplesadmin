// Unit tests for the server-side campaign-offer resolver
// (utils/campaign-offers.functions.ts).
//
// Why this suite matters: this module is the AUTHORITATIVE side of pricing.
// Its own header says it plainly - "What the storefront computes is a
// display; what happens here is what a card is charged." Until now it had
// no coverage at all, while being the code that decides how much money
// actually moves.
//
// It is also a deliberate MIRROR of the shared client-side resolver
// (src/common/src/shared/models/utils/campaign-offer.model.ts), duplicated
// because sync-shared only copies SDK-free slices into functions. Two
// copies of one pricing rule is exactly the arrangement that drifts, and a
// drift here means the price shown and the price charged disagree.
//
// Runs against ../lib via `npm test`; no emulator and no Firebase app -
// every function under test is pure. getActiveOffers is the one Firestore
// caller and is deliberately not tested here.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {
  offerApplies,
  offerPrice,
  bestOfferPrice,
  grantsFreeShipping,
} = require("../lib/utils/campaign-offers.functions");

const NOW = Date.UTC(2026, 7, 24, 12, 0, 0);
const HOUR = 3600000;
const DAY = 24 * HOUR;

/** An active, unrestricted 20%-off offer on one product. */
function offer(overrides = {}) {
  return {
    campaignId: "camp-1",
    target: {kind: "product", id: "prod-1"},
    discount: {type: "percentOff", value: 20},
    isActive: true,
    ...overrides,
  };
}

const product = (id = "prod-1", series = null) =>
  ({kind: "product", id, series});
const event = (id = "evt-1") => ({kind: "event", id});

// ----------------------------------------------------------- offerApplies

test("an active, in-window offer applies to its target product", () => {
  assert.equal(offerApplies(offer(), product(), NOW, null), true);
});

test("an inactive offer never applies", () => {
  // isActive is the published kill switch: END CAMPAIGN flips it, and a
  // discount that outlived its campaign is money given away.
  assert.equal(
    offerApplies(offer({isActive: false}), product(), NOW, null), false);
  assert.equal(
    offerApplies(offer({isActive: undefined}), product(), NOW, null), false);
});

test("an offer outside its own window does not apply", () => {
  const notYet = offer({startsAt: NOW + DAY});
  const expired = offer({endsAt: NOW - HOUR});
  assert.equal(offerApplies(notYet, product(), NOW, null), false);
  assert.equal(offerApplies(expired, product(), NOW, null), false);
});

test("an offer with no window applies indefinitely", () => {
  // Open-ended is legitimate: the campaign is ended by hand, not by date.
  assert.equal(
    offerApplies(offer({startsAt: 0, endsAt: 0}), product(), NOW, null), true);
});

test("the window boundaries are inclusive", () => {
  assert.equal(
    offerApplies(offer({startsAt: NOW}), product(), NOW, null), true);
  assert.equal(
    offerApplies(offer({endsAt: NOW}), product(), NOW, null), true);
});

test("an offer never applies to something it does not target", () => {
  assert.equal(
    offerApplies(offer(), product("other-product"), NOW, null), false);
  assert.equal(offerApplies(offer(), event(), NOW, null), false);
});

test("an offer with no target applies to nothing", () => {
  // A half-saved offer must discount nothing rather than everything.
  const noTarget = offer({target: undefined});
  const kindOnly = offer({target: {kind: "product"}});
  const idOnly = offer({target: {id: "prod-1"}});
  assert.equal(offerApplies(noTarget, product(), NOW, null), false);
  assert.equal(offerApplies(kindOnly, product(), NOW, null), false);
  assert.equal(offerApplies(idOnly, product(), NOW, null), false);
});

// ------------------------------------------------------- series targeting

test("a series offer matches a product by its series NAME", () => {
  // The bug this pins: the wizard once offered the series DOC ID while
  // ProductModel.series holds the display NAME, so series offers silently
  // matched nothing - the campaign saved, activated, reported itself live,
  // and no price ever moved.
  const name = "Making of a Disciple-Maker";
  const seriesOffer = offer({target: {kind: "series", id: name}});
  const inSeries = product("prod-9", name);
  assert.equal(offerApplies(seriesOffer, inSeries, NOW, null), true);
});

test("a series offer does not match a product in another series", () => {
  const seriesOffer = offer({target: {kind: "series", id: "Series A"}});
  assert.equal(
    offerApplies(seriesOffer, product("p", "Series B"), NOW, null), false);
});

test("a series offer does not match a product with no series", () => {
  const seriesOffer = offer({target: {kind: "series", id: "Series A"}});
  assert.equal(
    offerApplies(seriesOffer, product("p", null), NOW, null), false);
  assert.equal(
    offerApplies(seriesOffer, product("p", ""), NOW, null), false);
});

test("a series offer never matches an event", () => {
  const seriesOffer = offer({target: {kind: "series", id: "Series A"}});
  assert.equal(offerApplies(seriesOffer, event(), NOW, null), false);
});

// -------------------------------------------------------- the early-bird

test("an attribution-gated offer needs a buyer from that campaign", () => {
  // The early-bird rule. Enforced here as well as in the storefront
  // because the storefront is a display and this is the charge.
  const earlyBird = offer({
    target: {kind: "event", id: "evt-1"},
    requiresAttribution: true,
  });
  assert.equal(offerApplies(earlyBird, event(), NOW, "camp-1"), true);
  assert.equal(
    offerApplies(earlyBird, event(), NOW, "a-different-campaign"), false);
  assert.equal(offerApplies(earlyBird, event(), NOW, null), false);
});

test("an offer that does not require attribution ignores it entirely", () => {
  assert.equal(offerApplies(offer(), product(), NOW, null), true);
  assert.equal(
    offerApplies(offer(), product(), NOW, "unrelated-campaign"), true);
});

// ------------------------------------------------------------ offerPrice

test("percentOff discounts the base price", () => {
  assert.equal(offerPrice(50, {type: "percentOff", value: 20}), 40);
  assert.equal(offerPrice(18, {type: "percentOff", value: 50}), 9);
});

test("percentOff rounds to the cent", () => {
  // 15% off 22.99 is 19.541499999999996 in float - the exact shape of bug
  // that reaches a customer as a price with four decimal places.
  assert.equal(offerPrice(22.99, {type: "percentOff", value: 15}), 19.54);
});

test("fixedPrice ignores the base price entirely", () => {
  assert.equal(offerPrice(50, {type: "fixedPrice", value: 12.5}), 12.5);
  assert.equal(offerPrice(5, {type: "fixedPrice", value: 12.5}), 12.5);
});

test("a percentage is clamped, so a price can never go negative", () => {
  assert.equal(offerPrice(50, {type: "percentOff", value: 150}), 0);
  assert.equal(offerPrice(50, {type: "percentOff", value: -20}), 50);
  assert.equal(offerPrice(50, {type: "percentOff", value: 100}), 0);
});

test("a negative fixedPrice floors at zero, never pays the buyer", () => {
  assert.equal(offerPrice(50, {type: "fixedPrice", value: -10}), 0);
});

test("a malformed discount degrades to no discount, not a free item", () => {
  // A bad record must fail toward charging full price.
  assert.equal(offerPrice(50, undefined), 50);
  assert.equal(offerPrice(50, {}), 50);
  assert.equal(offerPrice(50, {type: "percentOff"}), 50);
});

test("a non-finite base price is treated as zero", () => {
  assert.equal(offerPrice(NaN, {type: "percentOff", value: 20}), 0);
  assert.equal(offerPrice(Infinity, {type: "percentOff", value: 20}), 0);
});

// -------------------------------------------------------- bestOfferPrice

test("the cheapest applicable offer wins when several compete", () => {
  // The pre-offer sale lookup was first-match-wins and ignored competing
  // discounts; this is the behaviour that replaced it.
  const offers = [
    offer({campaignId: "a", discount: {type: "percentOff", value: 10}}),
    offer({campaignId: "b", discount: {type: "percentOff", value: 40}}),
    offer({campaignId: "c", discount: {type: "fixedPrice", value: 35}}),
  ];
  assert.equal(bestOfferPrice(offers, product(), 50, NOW, null), 30);
});

test("offers that do not apply are excluded from the comparison", () => {
  const offers = [
    offer({
      campaignId: "expired",
      discount: {type: "fixedPrice", value: 1},
      endsAt: NOW - HOUR,
    }),
    offer({campaignId: "live", discount: {type: "percentOff", value: 10}}),
  ];
  // The 1.00 offer is expired; the buyer pays the 10%-off price, not 1.00.
  assert.equal(bestOfferPrice(offers, product(), 50, NOW, null), 45);
});

test("no applicable offer returns null, not zero", () => {
  // null means "no offer" and the caller keeps the base price. Returning 0
  // would hand the item over for free.
  assert.equal(bestOfferPrice([], product(), 50, NOW, null), null);
  assert.equal(
    bestOfferPrice([offer({isActive: false})], product(), 50, NOW, null),
    null);
  assert.equal(bestOfferPrice(undefined, product(), 50, NOW, null), null);
});

// ----------------------------------------------------- grantsFreeShipping

test("free shipping requires an offer that both grants it AND applies", () => {
  const shipping = offer({freeShipping: true});
  assert.equal(grantsFreeShipping([shipping], product(), NOW, null), true);
  const notFree = offer({freeShipping: false});
  assert.equal(grantsFreeShipping([notFree], product(), NOW, null), false);
  assert.equal(grantsFreeShipping([], product(), NOW, null), false);
});

test("an expired or untargeted free-shipping offer does not grant it", () => {
  const expired = offer({freeShipping: true, endsAt: NOW - HOUR});
  assert.equal(grantsFreeShipping([expired], product(), NOW, null), false);
  const otherProduct = offer({freeShipping: true});
  assert.equal(
    grantsFreeShipping([otherProduct], product("someone-else"), NOW, null),
    false);
});

test("an attribution-gated free-shipping offer respects attribution", () => {
  const gated = offer({freeShipping: true, requiresAttribution: true});
  assert.equal(
    grantsFreeShipping([gated], product(), NOW, "camp-1"), true);
  assert.equal(grantsFreeShipping([gated], product(), NOW, null), false);
});
