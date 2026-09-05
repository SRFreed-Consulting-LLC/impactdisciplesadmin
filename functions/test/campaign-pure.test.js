// Unit tests for the pure exports that live inside otherwise-Firestore-bound
// campaign/email modules. Requiring these modules registers their v2
// function definitions (onCall/onRequest objects) but calls nothing - no
// emulator or Firebase app needed as long as only the pure exports run.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {sanitizeAttribution} = require("../lib/campaign-tracking.functions");
const {effectiveCampaignStatus, campaignSendBudget, isTransientRelayError} =
  require("../lib/campaign-send.functions");
const {escapeHtml} = require("../lib/transactional-emails");

// ---- sanitizeAttribution --------------------------------------------------

test("sanitizeAttribution: valid full shape passes through trimmed", () => {
  assert.deepEqual(
    sanitizeAttribution({campaignId: " c1 ", emailId: " e1 ", source: "popup"}),
    {campaignId: "c1", emailId: "e1", source: "popup"}
  );
});

test("sanitizeAttribution: campaignId is mandatory", () => {
  assert.equal(sanitizeAttribution({}), null);
  assert.equal(sanitizeAttribution(null), null);
  assert.equal(sanitizeAttribution({campaignId: "   "}), null);
  assert.equal(sanitizeAttribution({campaignId: 42}), null);
});

test("sanitizeAttribution: oversize fields are dropped, not truncated", () => {
  assert.equal(sanitizeAttribution({campaignId: "x".repeat(65)}), null);
  assert.deepEqual(
    sanitizeAttribution({campaignId: "c1", emailId: "x".repeat(65)}),
    {campaignId: "c1"}
  );
  assert.deepEqual(
    sanitizeAttribution({campaignId: "c1", source: "x".repeat(33)}),
    {campaignId: "c1"}
  );
});

test("sanitizeAttribution: optional keys OMITTED when absent", () => {
  const out = sanitizeAttribution({campaignId: "c1"});
  assert.deepEqual(Object.keys(out), ["campaignId"]);
});

// ---- effectiveCampaignStatus ----------------------------------------------

const FUTURE = "2030-01-01T00:00:00.000Z";
const PAST = "2020-01-01T00:00:00.000Z";

test("status ended is always ended", () => {
  assert.equal(effectiveCampaignStatus({status: "ended"}), "ended");
});

test("a live campaign past its endDate reads as ended", () => {
  assert.equal(
    effectiveCampaignStatus({status: "live", endDate: PAST}),
    "ended"
  );
});

test("a DRAFT past its endDate stays draft (never auto-ends)", () => {
  assert.equal(
    effectiveCampaignStatus({status: "draft", endDate: PAST}),
    "draft"
  );
});

test("scheduled becomes live once startDate has arrived", () => {
  assert.equal(
    effectiveCampaignStatus(
      {status: "scheduled", startDate: PAST, endDate: FUTURE}),
    "live"
  );
  assert.equal(
    effectiveCampaignStatus({status: "scheduled", startDate: FUTURE}),
    "scheduled"
  );
});

test("missing status defaults to draft", () => {
  assert.equal(effectiveCampaignStatus({}), "draft");
});

// ---- escapeHtml -------------------------------------------------------------

test("escapeHtml: all five entities", () => {
  assert.equal(
    escapeHtml("<a href=\"x\" title='y'>&z</a>"),
    "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;z&lt;/a&gt;"
  );
});

test("escapeHtml: non-strings stringify, null/undefined become empty", () => {
  assert.equal(escapeHtml(42), "42");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});

// ---- campaignSendBudget -----------------------------------------------------
//
// The SMTP relay's confirmed ceiling is 2,000/hour, of which 200 is reserved
// for transactional mail, so campaigns may use 1,800. These pin the
// arithmetic; the rolling COUNT that feeds it is exercised end to end in
// integration/campaign-engine.test.js.

test("campaignSendBudget: an idle hour gives the full run ceiling", () => {
  assert.equal(campaignSendBudget(0, 300), 300);
});

test("campaignSendBudget: the run ceiling is the binding limit while the " +
  "hour still has room", () => {
  assert.equal(campaignSendBudget(600, 300), 300);
  assert.equal(campaignSendBudget(1000, 300), 300);
});

test("campaignSendBudget: near the cap the HOUR becomes the binding " +
  "limit, not the run ceiling", () => {
  // 1800 campaign budget - 1650 already queued = 150 left, under the 300 run
  // ceiling, so the hour wins.
  assert.equal(campaignSendBudget(1650, 300), 150);
  assert.equal(campaignSendBudget(1799, 300), 1);
});

test("campaignSendBudget: a spent hour yields exactly zero, never " +
  "negative", () => {
  assert.equal(campaignSendBudget(1800, 300), 0);
  assert.equal(campaignSendBudget(5000, 300), 0);
});

test("campaignSendBudget: transactional mail consumes campaign budget - " +
  "that is the whole point of counting the mail collection", () => {
  // 1,700 receipts/confirmations in the hour leave campaigns only 100,
  // even though the run ceiling would allow 300.
  assert.equal(campaignSendBudget(1700, 300), 100);
});

test("campaignSendBudget: the reserve is never spent - the largest " +
  "possible campaign hour still leaves headroom under the relay cap", () => {
  // Worst case: six full ticks in one hour.
  const perHour = campaignSendBudget(0, 300) * 6;
  assert.equal(perHour, 1800);
  assert.ok(perHour < 2000, "campaign sends must stay under the relay cap");
  assert.equal(2000 - perHour, 200, "200 stays free for transactional mail");
});

test("campaignSendBudget: a nonsense negative count cannot inflate the " +
  "budget past the run ceiling", () => {
  assert.equal(campaignSendBudget(-500, 300), 300);
});

// ---- isTransientRelayError ------------------------------------------------
//
// Decides whether a relay refusal goes back in the queue or gives up. SMTP
// says so itself: 4xx is temporary, 5xx is permanent. Getting it backwards
// costs in both directions - retrying a bad address forever, or dropping a
// recipient over a throttle that cleared in seconds. Eight people were dropped
// exactly that way on 2026-09-04.

test("the failure that started this is transient", () => {
  assert.equal(
    isTransientRelayError(
      "Error: Invalid login: 435 Unable to authenticate at present"
    ),
    true
  );
});

test("4xx is temporary", () => {
  assert.equal(
    isTransientRelayError("421 Too many concurrent SMTP connections"), true);
  assert.equal(isTransientRelayError("450 Requested action not taken"), true);
});

test("5xx is permanent - retrying only repeats the refusal", () => {
  assert.equal(
    isTransientRelayError("501 <x@y> domain missing or malformed"), false);
  assert.equal(isTransientRelayError("550 No such user here"), false);
  // The mid-2025 auth failure: the credentials were WRONG, not busy, and
  // retrying a wrong password is just a slower way to fail.
  assert.equal(
    isTransientRelayError("535 Incorrect authentication data"), false);
});

test("a 5xx anywhere in the text wins over a 4xx", () => {
  // Relay messages quote codes in prose; a permanent verdict must not be
  // overturned by a number that happens to appear beside it.
  assert.equal(
    isTransientRelayError("550 failed after 421 attempts"), false);
});

test("worded temporary failures count, even with no code", () => {
  assert.equal(isTransientRelayError("Connection timeout"), true);
  assert.equal(
    isTransientRelayError("Service temporarily unavailable"), true);
  assert.equal(
    isTransientRelayError("Too many messages, try again later"), true);
});

test("an unrecognised failure is NOT retried", () => {
  // Fails closed: an unknown error repeated three times is three chances to
  // annoy the relay, and the ledger records it either way.
  assert.equal(isTransientRelayError("something went wrong"), false);
  assert.equal(isTransientRelayError(""), false);
  assert.equal(isTransientRelayError(undefined), false);
});
