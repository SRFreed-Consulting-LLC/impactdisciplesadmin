const {tenantPath} = require("../scripts/lib/tenancy");
// Integration: Campaign Manager v2's unified send engine + tracking,
// through the REAL Cloud Functions in the emulator -
// campaign-send.functions.ts (enqueueCampaignEmail /
// previewCampaignAudience / sendCampaignTestEmail callables) and
// campaign-tracking.functions.ts (campaign_open pixel, campaign_click
// link-map redirect).
// Charter area: Campaigns - the one server-side path every campaign email
// goes through, and the ledger-token tracking built on it.
//
// NOTE the hourly campaignSendScheduler can't be cron-fired here, and it
// isn't needed: sendConfig.mode 'now' drains up to 25 sends inside the
// enqueueCampaignEmail call itself (IMMEDIATE_DRAIN_BUDGET), so a 6-
// recipient touch is fully sent (and finalized to status 'sent') by the
// time the callable returns - every assertion below is synchronous.
const {test, before} = require("node:test");
const assert = require("node:assert/strict");
const {FN_BASE, getDb, preflight, reseed, callCallable, signIn} =
  require("./helpers/emulator");

const CAMPAIGN = "camp-live";
const TOUCH = "cemail-int-now";
// The shape the admin app actually writes (send-subscription-dialog etc).
const NEWSLETTER_AUDIENCE = {mode: "flags", flags: ["subscribedToNewsletter"]};
const NEWSLETTER_EMAILS = [1, 2, 3, 4, 5, 6]
  .map((i) => `casey0${i}@contacts.test`);

let db;
let adminToken;

const httpGet = (name, query) =>
  fetch(`${FN_BASE}/${name}?${query}`, {redirect: "manual"});
const touchData = async () =>
  (await db.collection(tenantPath("campaign_emails")).doc(TOUCH).get()).data();
const campaignStats = async () =>
  (await db.collection(tenantPath("campaigns")).doc(CAMPAIGN).get()).data().stats;
const ledgerFor = async (email) =>
  (await db.collection(tenantPath("campaign_sends")).doc(`${TOUCH}__${email}`).get())
    .data();

before(async () => {
  await preflight();
  reseed();
  db = getDb();
  adminToken = await signIn("admin@test.local");
});

test("previewCampaignAudience resolves the newsletter flag to exactly " +
  "the 6 subscribed customers", async () => {
  const res = await callCallable("previewCampaignAudience",
    {audience: NEWSLETTER_AUDIENCE}, adminToken);
  assert.equal(res.status, 200, JSON.stringify(res.error));
  assert.equal(res.result.count, 6);
  assert.deepEqual(res.result.sample, NEWSLETTER_EMAILS); // sorted, <10
});

test("camp-live's own stored audience shape ({mode:'newsletter'}) is NOT " +
  "a mode resolveAudience accepts - pinned as invalid-argument", async () => {
  // The fixture doc carries audience {mode:'newsletter'}, but the resolver
  // (and the admin UI, which writes {mode:'flags', flags:[...]}) knows
  // only everyone|flags|tags|list. Any send/preview leaning on that stored
  // audience therefore fails - the touches below carry an explicit
  // audienceOverride instead. Reported as a fixture/code mismatch.
  const res = await callCallable("previewCampaignAudience",
    {audience: {mode: "newsletter"}}, adminToken);
  assert.equal(res.result, undefined);
  assert.equal(res.error.status, "INVALID_ARGUMENT");
});

test("enqueueCampaignEmail rejects unauthenticated and non-Admin-role " +
  "callers", async () => {
  const anon = await callCallable("enqueueCampaignEmail", {emailId: TOUCH});
  assert.equal(anon.error.status, "UNAUTHENTICATED");

  // employee@test.local IS staff (admin_users) but role Employee -
  // requireAdminRole checks the role, not mere membership.
  const employeeToken = await signIn("employee@test.local");
  const emp = await callCallable("enqueueCampaignEmail",
    {emailId: TOUCH}, employeeToken);
  assert.equal(emp.error.status, "PERMISSION_DENIED");
});

test("enqueue mode 'now': one ledger doc per recipient ({touch}__{email} " +
  "ids with tokens), immediate drain, tracked+footered mail docs, link " +
  "map stored, sent counters bumped", async () => {
  await db.collection(tenantPath("campaign_emails")).doc(TOUCH).set({
    campaignId: CAMPAIGN,
    label: "Integration send",
    subject: "Hello *|FNAME|*",
    // One public-site link (gets the l1 map entry + cid/ceid decoration),
    // NO *|UNSUB|* tag - so the fallback unsubscribe footer path runs.
    html: "<p>Hi *|FNAME|*!</p>" +
      "<p><a href=\"https://impactdisciples.com/blog\">Read the blog</a></p>",
    status: "draft",
    sendConfig: {mode: "now"},
    audienceOverride: NEWSLETTER_AUDIENCE,
    stats: {sent: 0, delivered: 0, opens: 0, uniqueOpens: 0,
      clicks: 0, uniqueClicks: 0},
  });

  const res = await callCallable("enqueueCampaignEmail",
    {emailId: TOUCH}, adminToken);
  assert.equal(res.status, 200, JSON.stringify(res.error));
  assert.deepEqual(res.result,
    {recipients: 6, queued: 6, sentImmediately: 6});

  // Ledger: at-most-once per recipient, deterministic ids, each tokened.
  const ledgers = await db.collection(tenantPath("campaign_sends"))
    .where("emailId", "==", TOUCH).get();
  assert.equal(ledgers.size, 6);
  for (const email of NEWSLETTER_EMAILS) {
    const ledger = await ledgerFor(email);
    assert.ok(ledger, `ledger ${TOUCH}__${email} exists`);
    assert.equal(ledger.status, "sent");
    assert.equal(ledger.unsubType, "newsletter");
    assert.ok(ledger.token.length >= 20, "crypto token present");
    assert.ok(ledger.mailDocId);
  }

  // Outgoing mail: merge-rendered, per-recipient tracking, exactly ONE
  // unsubscribe link (the appended fallback footer - never doubled).
  const mail = await db.collection("mail")
    .where("campaignMeta.emailId", "==", TOUCH).get();
  assert.equal(mail.size, 6);
  const casey01 = await ledgerFor("casey01@contacts.test");
  const mailDoc = (await db.collection("mail")
    .doc(casey01.mailDocId).get()).data();
  assert.equal(mailDoc.to, "casey01@contacts.test");
  assert.equal(mailDoc.message.subject, "Hello Casey01");
  const html = mailDoc.message.html;
  assert.ok(html.includes("Hi Casey01!"), "merge tags rendered");
  assert.ok(html.includes(`/campaign_click?t=${casey01.token}&amp;l=l1`),
    "href rewritten to the tracked click redirect");
  assert.ok(!html.includes("href=\"https://impactdisciples.com/blog\""),
    "raw target no longer appears as an href");
  assert.ok(html.includes(`/campaign_open?t=${casey01.token}`),
    "open pixel injected");
  const unsubMatches =
    html.split("unsubscribe_from_email_list").length - 1;
  assert.equal(unsubMatches, 1, "exactly one unsubscribe link");
  assert.ok(html.includes(
    "unsubscribe_from_email_list?email=casey01%40contacts.test" +
    "&type=newsletter"));

  // Link map stored on the touch: l1 -> original URL decorated with the
  // attribution params (cid/ceid) since it points at the public site.
  const touch = await touchData();
  assert.deepEqual(touch.links, {
    l1: `https://impactdisciples.com/blog?cid=${CAMPAIGN}&ceid=${TOUCH}`,
  });
  assert.equal(touch.status, "sent"); // fully drained -> finalized
  assert.equal(touch.recipientCount, 6);
  assert.equal(touch.stats.sent, 6);
  assert.equal((await campaignStats()).sent, 6);
});

test("re-enqueueing the same touch creates no duplicate ledger docs and " +
  "re-sends nothing", async () => {
  // A finalized touch can't even be re-enqueued...
  const refused = await callCallable("enqueueCampaignEmail",
    {emailId: TOUCH}, adminToken);
  assert.equal(refused.error.status, "FAILED_PRECONDITION");

  // ...and even forced back to draft, the ledger's atomic create() is the
  // at-most-once lock: ALREADY_EXISTS is skipped, nothing re-queues.
  await db.collection(tenantPath("campaign_emails")).doc(TOUCH)
    .update({status: "draft"});
  const res = await callCallable("enqueueCampaignEmail",
    {emailId: TOUCH}, adminToken);
  assert.deepEqual(res.result,
    {recipients: 6, queued: 0, sentImmediately: 0});

  const ledgers = await db.collection(tenantPath("campaign_sends"))
    .where("emailId", "==", TOUCH).get();
  assert.equal(ledgers.size, 6); // still 6, no dupes
  const mail = await db.collection("mail")
    .where("campaignMeta.emailId", "==", TOUCH).get();
  assert.equal(mail.size, 6); // no re-sends
  assert.equal((await touchData()).stats.sent, 6);
  assert.equal((await campaignStats()).sent, 6);
});

test("an unsubscribed recipient is skipped at send time (ledger status " +
  "'skipped', no mail doc)", async () => {
  // casey09 is NOT newsletter-subscribed; a list-mode audience still
  // resolves them, and the send-time re-check skips them.
  const touchId = "cemail-int-skip";
  await db.collection(tenantPath("campaign_emails")).doc(touchId).set({
    campaignId: CAMPAIGN,
    subject: "You should never get this",
    html: "<p>marketing</p>",
    status: "draft",
    sendConfig: {mode: "now"},
    audienceOverride: {mode: "list", emails: ["casey09@contacts.test"]},
    stats: {sent: 0},
  });
  const res = await callCallable("enqueueCampaignEmail",
    {emailId: touchId}, adminToken);
  assert.equal(res.result.recipients, 1);

  const ledger = (await db.collection(tenantPath("campaign_sends"))
    .doc(`${touchId}__casey09@contacts.test`).get()).data();
  assert.equal(ledger.status, "skipped");
  assert.match(ledger.error, /unsubscribed/);
  assert.equal((await db.collection("mail")
    .where("campaignMeta.emailId", "==", touchId).get()).size, 0);
  assert.equal((await db.collection(tenantPath("campaign_emails")).doc(touchId).get())
    .data().stats.sent, 0);
});

test("campaign_open bumps opens on every hit but uniqueOpens only once " +
  "per recipient", async () => {
  const {token} = await ledgerFor("casey01@contacts.test");

  const first = await httpGet("campaign_open", `t=${token}`);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("content-type"), "image/gif");
  let touch = await touchData();
  assert.equal(touch.stats.opens, 1);
  assert.equal(touch.stats.uniqueOpens, 1);
  assert.ok((await ledgerFor("casey01@contacts.test")).openedAt);

  await httpGet("campaign_open", `t=${token}`);
  touch = await touchData();
  assert.equal(touch.stats.opens, 2);
  assert.equal(touch.stats.uniqueOpens, 1); // gated by ledger openedAt
  const stats = await campaignStats();
  assert.equal(stats.opens, 2);
  assert.equal(stats.uniqueOpens, 1);
});

test("campaign_click 302s to the STORED link-map target, bumps clicks/" +
  "uniqueClicks, and backfills the unique open for image-blocked clients",
async () => {
  const {token} = await ledgerFor("casey02@contacts.test");

  const first = await httpGet("campaign_click", `t=${token}&l=l1`);
  assert.equal(first.status, 302);
  assert.equal(first.headers.get("location"),
    `https://impactdisciples.com/blog?cid=${CAMPAIGN}&ceid=${TOUCH}`);

  let touch = await touchData();
  assert.equal(touch.stats.clicks, 1);
  assert.equal(touch.stats.uniqueClicks, 1);
  // casey02 never fired the pixel: the click backfills their unique open
  // (uniqueOpens 1 from casey01 + 1 backfill) but NOT the raw opens count.
  assert.equal(touch.stats.uniqueOpens, 2);
  assert.equal(touch.stats.opens, 2);
  const ledger = await ledgerFor("casey02@contacts.test");
  assert.ok(ledger.clickedAt);
  assert.ok(ledger.openedAt);

  const second = await httpGet("campaign_click", `t=${token}&l=l1`);
  assert.equal(second.status, 302);
  touch = await touchData();
  assert.equal(touch.stats.clicks, 2);
  assert.equal(touch.stats.uniqueClicks, 1); // gated by ledger clickedAt
  assert.equal(touch.stats.uniqueOpens, 2);
});

test("campaign_click never redirects to a query-supplied URL - an " +
  "unmapped l (even a full URL) and an unknown token both land on the " +
  "fallback", async () => {
  const {token} = await ledgerFor("casey03@contacts.test");
  const evil = await httpGet("campaign_click",
    `t=${token}&l=${encodeURIComponent("https://evil.example/phish")}`);
  assert.equal(evil.status, 302);
  assert.equal(evil.headers.get("location"), "https://impactdisciples.com");

  const unknown = await httpGet("campaign_click", "t=not-a-real-token&l=l1");
  assert.equal(unknown.status, 302);
  assert.equal(unknown.headers.get("location"),
    "https://impactdisciples.com");
});

test("sendCampaignTestEmail queues one [TEST] mail with no ledger and no " +
  "funnel counts", async () => {
  const statsBefore = (await touchData()).stats;
  const res = await callCallable("sendCampaignTestEmail",
    {emailId: TOUCH, to: "designer@test.local"}, adminToken);
  assert.equal(res.status, 200, JSON.stringify(res.error));

  const mailDoc = (await db.collection("mail")
    .doc(res.result.mailDocId).get()).data();
  assert.equal(mailDoc.to, "designer@test.local");
  assert.equal(mailDoc.message.subject, "[TEST] Hello Alex");
  assert.equal(mailDoc.campaignMeta, undefined); // never in any funnel

  const ledgers = await db.collection(tenantPath("campaign_sends"))
    .where("emailId", "==", TOUCH).get();
  assert.equal(ledgers.size, 6); // unchanged
  assert.equal((await touchData()).stats.sent, statsBefore.sent);
});
