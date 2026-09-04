const {tenantPath} = require("../scripts/lib/tenancy");
// Integration: the SMTP send throttle, through the REAL enqueueCampaignEmail
// callable in the emulator.
// Charter area: Campaigns - specifically the guarantee that we never hand the
// org's mail server more than it will accept.
//
// WHY THIS IS ITS OWN FILE. campaign-engine.test.js asserts on the `mail`
// collection; this suite deliberately FLOODS that collection to drive the
// budget to zero, so the two must not share a world. Suites run
// --test-concurrency=1 and reseed in before(), and this one also removes its
// own flood before it ends.
//
// WHAT IT PINS. The hosting provider confirmed 2,000 messages/hour on
// 2026-09-04. campaign-send.functions.ts reserves 200 of those for
// transactional mail and measures the rest by COUNTING the `mail` collection
// over a rolling hour - which is the only reason a receipt, a test send or an
// admin-composed email consumes budget at all. The unit tests
// (functions/test/campaign-pure.test.js) pin the arithmetic; only this file
// can show that the measurement is wired to the real send path, that the
// count() aggregation works against a live Firestore, and that a spent hour
// actually STOPS a send rather than merely logging about it.
//
// NOTE, as in campaign-engine.test.js: campaignSendScheduler cannot be
// cron-fired here, so these tests assert that throttled work is left PARKED
// and recoverable (touch "sending", ledger "queued", nothing in `mail`) -
// which is precisely the state the next tick drains. What they cannot show is
// the tick itself.
const {test, before, after} = require("node:test");
const assert = require("node:assert/strict");
const {getDb, preflight, reseed, callCallable, signIn} =
  require("./helpers/emulator");

const CAMPAIGN = "camp-live";
const NEWSLETTER_AUDIENCE = {mode: "flags", flags: ["subscribedToNewsletter"]};
// Campaign budget is SMTP_HOURLY_CAP - TRANSACTIONAL_RESERVE = 1800. Flooding
// exactly that many leaves zero, without depending on the per-run ceiling.
const CAMPAIGN_HOURLY_BUDGET = 1800;
// Marks this suite's own flood docs so cleanup can never touch a real one.
const FLOOD_TAG = "throttleFlood";

let db;
let adminToken;

const ledgerStatuses = async (touch) => {
  const snap = await db.collection(tenantPath("campaign_sends"))
    .where("emailId", "==", touch).get();
  return snap.docs.map((d) => d.data().status).sort();
};

const touchStatus = async (touch) =>
  (await db.collection(tenantPath("campaign_emails")).doc(touch).get())
    .data().status;

/** Mail docs actually handed to the relay for this touch. */
const relayedFor = async (touch) => {
  const snap = await db.collection("mail")
    .where("campaignMeta.emailId", "==", touch).get();
  return snap.size;
};

/**
 * Writes `n` mail docs dated now, so the rolling-hour count sees them.
 * A JS Date is stored as a Firestore Timestamp, so the function-side range
 * query sees these exactly as it sees real mail.
 * @param {number} n How many to write.
 */
async function floodMail(n) {
  const writer = db.bulkWriter();
  for (let i = 0; i < n; i++) {
    writer.create(db.collection("mail").doc(), {
      to: `flood${i}@example.test`,
      date: new Date(),
      message: {subject: "flood", html: "x", text: "x"},
      [FLOOD_TAG]: true,
    });
  }
  await writer.close();
}

/**
 * Removes every doc this suite wrote.
 * @return {Promise<number>} How many were cleared.
 */
async function clearFlood() {
  let cleared = 0;
  for (;;) {
    const snap = await db.collection("mail")
      .where(FLOOD_TAG, "==", true).limit(400).get();
    if (snap.empty) return cleared;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    cleared += snap.size;
  }
}

/**
 * A fresh draft touch on the seeded live campaign. Each test uses its own
 * id: a throttled enqueue leaves the touch "sending", and the callable
 * rightly refuses to re-enqueue one, so ids cannot be shared.
 * @param {string} id The touch doc id.
 * @return {Promise<string>} The same id.
 */
async function newTouch(id) {
  await db.collection(tenantPath("campaign_emails")).doc(id).set({
    campaignId: CAMPAIGN,
    subject: "Throttle probe",
    html: "<p>Hello *|FNAME|*</p>",
    status: "draft",
    sendConfig: {mode: "now"},
    audienceOverride: NEWSLETTER_AUDIENCE,
    stats: {sent: 0, delivered: 0, opens: 0, uniqueOpens: 0,
      clicks: 0, uniqueClicks: 0},
  });
  return id;
}

before(async () => {
  await preflight();
  reseed();
  db = getDb();
  adminToken = await signIn("admin@test.local");
  await clearFlood();
});

after(async () => {
  await clearFlood();
});

test("a spent hour STOPS the send: recipients are reserved, but nothing " +
  "is handed to the relay", async () => {
  const touch = await newTouch("cemail-throttle-blocked");
  await floodMail(CAMPAIGN_HOURLY_BUDGET);

  const res = await callCallable("enqueueCampaignEmail", {emailId: touch},
    adminToken);
  assert.equal(res.status, 200, JSON.stringify(res.error));

  // The reservation still happens - the audience is resolved and the ledger
  // is written, so nobody is dropped. Only the DRAIN is withheld.
  assert.equal(res.result.recipients, 6, "the audience still resolves");
  assert.equal(res.result.queued, 6, "every recipient is still reserved");
  assert.equal(res.result.sentImmediately, 0,
    "a spent hour must send nothing at all");

  // The claim that actually matters: the relay saw nothing.
  assert.equal(await relayedFor(touch), 0,
    "no mail document was created - nothing reached the mail server");

  await clearFlood();
});

test("throttled work is PARKED, not dropped - the state the next tick " +
  "drains", async () => {
  // Continues from the test above, whose touch was throttled off entirely.
  const touch = "cemail-throttle-blocked";

  assert.deepEqual(await ledgerStatuses(touch), Array(6).fill("queued"),
    "all six reservations wait as queued - none failed or was skipped");
  assert.equal(await touchStatus(touch), "sending",
    "the touch stays sending, so finalizeSendingTouches cannot close it " +
    "out as finished while recipients are still waiting");
});

test("budget restored: this send goes out in full AND the parked one " +
  "resumes - the throttle defers, it never drops", async () => {
  // Two things at once, because the same drain proves both.
  //
  // (1) THE CONTROL. Same touch shape, same callable, no flood. Without it a
  //     throttle bug that blocked EVERYTHING would still pass every other
  //     assertion in this file.
  // (2) THE RECOVERY. drainQueued takes the oldest QUEUED reservations
  //     across every touch, not just the one being enqueued - so freeing the
  //     budget also drains the six this suite parked earlier. That is the
  //     property worth pinning: throttled recipients are deferred, and the
  //     next drain of any kind picks them up. (Draining oldest-first across
  //     touches is long-standing behaviour, not new here; it is what stops
  //     one big campaign starving a later small one.)
  const parked = "cemail-throttle-blocked";
  const touch = await newTouch("cemail-throttle-clear");

  const res = await callCallable("enqueueCampaignEmail", {emailId: touch},
    adminToken);
  assert.equal(res.status, 200, JSON.stringify(res.error));

  assert.deepEqual(await ledgerStatuses(touch), Array(6).fill("sent"),
    "the new touch sent in full");
  assert.equal(await relayedFor(touch), 6,
    "six mail documents reached the relay");

  assert.deepEqual(await ledgerStatuses(parked), Array(6).fill("sent"),
    "the six parked by the throttle were picked up, not lost");
  assert.equal(await relayedFor(parked), 6,
    "the deferred recipients did eventually reach the relay");

  assert.equal(res.result.sentImmediately, 12,
    "one drain covered both touches - 6 deferred plus 6 new");
});

test("TRANSACTIONAL mail consumes the same budget campaigns draw on - " +
  "the reason the count is taken over the mail collection itself",
async () => {
  const touch = await newTouch("cemail-throttle-transactional");
  // Not campaign mail: no campaignMeta, exactly the shape queueMail writes
  // for a receipt. It must still push the campaign budget to zero. This is
  // the property the old per-run constant did not have at all.
  await floodMail(CAMPAIGN_HOURLY_BUDGET);

  const res = await callCallable("enqueueCampaignEmail", {emailId: touch},
    adminToken);
  assert.equal(res.status, 200, JSON.stringify(res.error));
  assert.equal(res.result.sentImmediately, 0,
    "mail with no campaignMeta still counts against the cap");
  assert.equal(await relayedFor(touch), 0);

  await clearFlood();
});

test("the reserve is real: a receipt still goes out while campaign sends " +
  "are throttled off", async () => {
  await floodMail(CAMPAIGN_HOURLY_BUDGET);
  // TRANSACTIONAL_RESERVE is why the campaign budget stops at 1,800 rather
  // than 2,000: a customer who buys something during a blast must not wait
  // behind it. Nothing in the send path can refuse this write.
  const receipt = await db.collection("mail").add({
    to: "buyer@example.test",
    date: new Date(),
    message: {subject: "Your receipt", html: "<p>thanks</p>", text: "thanks"},
    [FLOOD_TAG]: true,
  });
  assert.ok((await receipt.get()).exists,
    "a receipt is never blocked by a campaign blast");

  await clearFlood();
});
