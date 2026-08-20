// Unit tests for the pure tag-rule matcher pieces (matchRules/resolveTag/
// registrationWasPaid and the multi-id rule shapes added 2026-08-20).
// These run against the COMPILED output (../lib) via `npm test`, which
// builds first - plain node:test, no emulator, no Firebase app.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {
  matchRules,
  resolveTag,
  registrationWasPaid,
  ruleProductIds,
  ruleEventIds,
} = require("../lib/tag-rules.functions");

const {Timestamp} = require("firebase-admin/firestore");

const now = Timestamp.fromMillis(1700000000000);

/**
 * Builds a purchase activity with the given cart product ids.
 * @param {string[]} productIds Cart product ids.
 * @return {object} ActivityForTagging shape.
 */
function purchase(productIds) {
  return {
    source: "purchase", sourceId: "p1", email: "a@b.c",
    productIds, eventId: null, activityDate: now,
  };
}

/**
 * Builds a registration activity for the given event.
 * @param {string} eventId The registered event id.
 * @param {object} extra Enrichment overrides (isSummit/paid/receipt).
 * @return {object} ActivityForTagging shape.
 */
function registration(eventId, extra = {}) {
  return {
    source: "event-registration", sourceId: "r1", email: "a@b.c",
    productIds: [], eventId, activityDate: now, ...extra,
  };
}

test("purchase rule matches when ANY of its productIds is in the cart", () => {
  const rule = {id: "1", trigger: "purchase", tag: "Impact 1",
    productIds: ["book", "digital", "bundle"], active: true};
  assert.equal(matchRules([rule], purchase(["bundle"])).length, 1);
  assert.equal(matchRules([rule], purchase(["other"])).length, 0);
});

test("legacy single productId shape still matches", () => {
  const rule = {id: "1", trigger: "purchase", tag: "T",
    productId: "book", active: true};
  assert.equal(matchRules([rule], purchase(["book"])).length, 1);
  // productIds, when present and nonempty, supersedes productId.
  assert.deepEqual(
    ruleProductIds({productId: "old", productIds: ["new"]}), ["new"]);
  assert.deepEqual(ruleProductIds({productId: "old"}), ["old"]);
});

test("event rule matches any event in eventIds (legacy eventId too)", () => {
  const rule = {id: "1", trigger: "event-registration", tag: "DMC",
    eventIds: ["e1", "e2"], active: true};
  assert.equal(matchRules([rule], registration("e2")).length, 1);
  assert.equal(matchRules([rule], registration("e3")).length, 0);
  assert.deepEqual(ruleEventIds({eventId: "solo"}), ["solo"]);
});

test("summit rule matches only summit-enriched registrations", () => {
  const rule = {id: "s", trigger: "summit-registration",
    tag: "Summit", paidTag: "Paid Summit", active: true};
  assert.equal(
    matchRules([rule], registration("e1", {isSummit: true})).length, 1);
  assert.equal(
    matchRules([rule], registration("e1", {isSummit: false})).length, 0);
  // Unenriched (isSummit undefined) never matches.
  assert.equal(matchRules([rule], registration("e1")).length, 0);
});

test("summit rule resolves paidTag vs tag off activity.paid", () => {
  const rule = {trigger: "summit-registration",
    tag: "Summit", paidTag: "Paid Summit"};
  assert.equal(
    resolveTag(rule, registration("e1", {isSummit: true, paid: true})),
    "Paid Summit");
  assert.equal(
    resolveTag(rule, registration("e1", {isSummit: true, paid: false})),
    "Summit");
});

test("summit rule with an empty side does not match that side", () => {
  const rule = {id: "s", trigger: "summit-registration",
    tag: "", paidTag: "Paid Summit", active: true};
  assert.equal(matchRules(
    [rule], registration("e1", {isSummit: true, paid: false})).length, 0);
  assert.equal(matchRules(
    [rule], registration("e1", {isSummit: true, paid: true})).length, 1);
});

test("inactive rules never match", () => {
  const rule = {id: "1", trigger: "purchase", tag: "T",
    productIds: ["book"], active: false};
  assert.equal(matchRules([rule], purchase(["book"])).length, 0);
});

test("registrationWasPaid: payment id yes; coupon code or empty no", () => {
  const codes = new Set(["CRFREE", "ENGLISHCHURCHGROUP", "ULYSSES"]);
  assert.equal(registrationWasPaid("1JS535179X0923522", codes), true);
  assert.equal(registrationWasPaid("pi_3RcqnrC4Pv6WfeJr0Ug94RPX", codes), true);
  assert.equal(registrationWasPaid("CRFREE", codes), false);
  // Case-insensitive - codes are stored mixed-case ("Ulysses").
  assert.equal(registrationWasPaid("ulysses", codes), false);
  assert.equal(registrationWasPaid("", codes), false);
  assert.equal(registrationWasPaid(undefined, codes), false);
});
