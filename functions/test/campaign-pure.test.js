// Unit tests for the pure exports that live inside otherwise-Firestore-bound
// campaign/email modules. Requiring these modules registers their v2
// function definitions (onCall/onRequest objects) but calls nothing - no
// emulator or Firebase app needed as long as only the pure exports run.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {sanitizeAttribution} = require("../lib/campaign-tracking.functions");
const {effectiveCampaignStatus} = require("../lib/campaign-send.functions");
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
