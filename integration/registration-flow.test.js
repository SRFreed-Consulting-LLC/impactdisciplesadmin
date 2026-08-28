// Integration: the public event-registration flow, end to end through the
// REAL Cloud Functions running in the emulator (registerForEventHttp,
// checkRegistrationExistsHttp, updateMySessionsHttp, getSessionCountsHttp)
// plus the onEventRegistrationSessionCounts trigger they feed.
// Charter area: Events / Summit registration.
const {test, before} = require("node:test");
const assert = require("node:assert/strict");
const {getDb, preflight, reseed, callHttp, waitFor} =
  require("./helpers/emulator");

const SUMMIT = "event-summit-2027";
let db;

// The emulator processes Firestore triggers one-at-a-time and SLOWLY -
// reseeding queues ~90 trigger invocations (30 registrations x counts/
// upsert/alert), and tests that assert on counter side effects must not
// race that backlog. settleCounts() waits for the counter doc to reach an
// exact expected state.
const settleCounts = (expected, label) => waitFor(async () => {
  const meta = await db.collection("eventSessionCounts").doc(SUMMIT).get();
  const counts = meta.data()?.counts ?? {};
  return Object.entries(expected).every(([k, v]) => counts[k] === v) &&
    Object.keys(counts).every((k) => expected[k] !== undefined ?
      counts[k] === expected[k] : counts[k] === 0);
}, {timeoutMs: 120000, intervalMs: 1000, label});

before(async () => {
  await preflight();
  reseed();
  db = getDb();
  await settleCounts(
    {"agenda-breakout-a": 10, "agenda-breakout-b": 8, "agenda-breakout-c": 2},
    "seed trigger backlog to drain"
  );
});

test("register_for_event creates the doc with the lastNameLower sort key " +
  "and queues the confirmation email", async () => {
  const res = await callHttp("register_for_event", {
    eventId: SUMMIT,
    firstName: "  Nina ",
    lastName: "Newcomer",
    email: "NINA@Example.TEST",
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.registrationId);

  const doc = await db.collection("event-registrations")
    .doc(res.body.registrationId).get();
  const data = doc.data();
  assert.equal(data.firstName, "Nina"); // trimmed
  assert.equal(data.lastName, "Newcomer");
  assert.equal(data.lastNameLower, "newcomer");
  assert.equal(data.email, "nina@example.test"); // lowercased
  assert.deepEqual(data.trainingSessions, []);

  // The summit fixture names a real mail_templates doc, so a mail doc must
  // have been queued and stamped back onto the registration.
  assert.ok(res.body.receiptEmailId, "receiptEmailId missing - confirmation not queued");
  const mail = await db.collection("mail").doc(res.body.receiptEmailId).get();
  assert.ok(mail.exists);
  assert.equal(mail.data().to, "nina@example.test");
});

test("register_for_event validates input and event state", async () => {
  const missing = await callHttp("register_for_event", {
    eventId: SUMMIT, firstName: "X", lastName: "", email: "x@y.test",
  });
  assert.equal(missing.status, 400);

  const badEmail = await callHttp("register_for_event", {
    eventId: SUMMIT, firstName: "X", lastName: "Y", email: "not-an-email",
  });
  assert.equal(badEmail.status, 400);

  const noEvent = await callHttp("register_for_event", {
    eventId: "nope", firstName: "X", lastName: "Y", email: "x@y.test",
  });
  assert.equal(noEvent.status, 400);
});

// Finding S9. register_for_event has to stay anonymous - attendees have no
// accounts - which made it an outbound-email amplifier: N POSTs naming a
// public eventId queued N branded confirmations to any address the caller
// chose, from the org's own authenticated sending domain, and fanned each
// one out into the staff alert counter and the customer-upsert trigger.
test("register_for_event is idempotent and cannot amplify email at a " +
  "victim address", async () => {
  const victim = "victim@amplifier.test";
  const payload = {
    eventId: SUMMIT, firstName: "Vic", lastName: "Tim", email: victim,
  };

  const first = await callHttp("register_for_event", payload);
  assert.equal(first.status, 200);
  assert.ok(first.body.registrationId);

  for (let i = 0; i < 4; i++) {
    const again = await callHttp("register_for_event", payload);
    // A repeat is a no-op, not an error - a shopper double-clicking must
    // not see a failure for something that already succeeded.
    assert.equal(again.status, 200);
    assert.equal(again.body.alreadyRegistered, true);
  }

  // The dedupe key is (eventId, email) ALONE - owner's decision
  // 2026-08-28. Varying the name must not buy another send, because that
  // is exactly how an attacker would defeat a name-aware key.
  const renamed = await callHttp("register_for_event", {
    ...payload, firstName: "Someone", lastName: "Else",
  });
  assert.equal(renamed.body.alreadyRegistered, true);

  const regs = await db.collection("event-registrations")
    .where("eventId", "==", SUMMIT).where("email", "==", victim).get();
  assert.equal(regs.size, 1, "duplicate roster rows were created");

  const mail = await db.collection("mail").where("to", "==", victim).get();
  assert.equal(mail.size, 1, "the victim was emailed more than once");
});

// The naive dedupe - answer with the registration you found - would have
// opened a PII hole: get_event_registration is unauthenticated and returns
// that attendee's name, email and receipt for any id it is given.
test("a repeat registration never hands back the existing id", async () => {
  const email = "known@amplifier.test";
  const payload = {
    eventId: SUMMIT, firstName: "Known", lastName: "Person", email,
  };

  const created = await callHttp("register_for_event", payload);
  const realId = created.body.registrationId;
  assert.ok(realId);

  // An attacker who merely GUESSES the address must learn nothing usable.
  const probe = await callHttp("register_for_event", payload);
  assert.equal(probe.body.registrationId, null);
  assert.ok(!JSON.stringify(probe.body).includes(realId),
    "the response leaked the registration id");

  // Proof the id would have been worth stealing.
  const lookup = await callHttp("get_event_registration",
    {registrationId: realId});
  assert.equal(lookup.body.registration.email, email);
});

test("check_registration_exists answers boolean-only", async () => {
  const yes = await callHttp("check_registration_exists", {
    eventId: SUMMIT, email: "attendee01@summit.test",
  });
  assert.equal(yes.status, 200);
  assert.deepEqual(yes.body, {exists: true});

  const no = await callHttp("check_registration_exists", {
    eventId: SUMMIT, email: "stranger@nowhere.test",
  });
  assert.deepEqual(no.body, {exists: false});
});

test("update_my_sessions arrayUnions/arrayRemoves and the counts trigger " +
  "reconciles", async () => {
  // Fresh registration so this test owns its own doc.
  const reg = await callHttp("register_for_event", {
    eventId: SUMMIT, firstName: "Quinn", lastName: "Queue",
    email: "quinn@example.test",
  });
  const regId = reg.body.registrationId;

  const add = await callHttp("update_my_sessions", {
    registrationId: regId, sessionId: "agenda-breakout-b", action: "add",
  });
  assert.deepEqual(add.body.trainingSessions, ["agenda-breakout-b"]);

  // Adding the same session twice stays a set (arrayUnion).
  const addAgain = await callHttp("update_my_sessions", {
    registrationId: regId, sessionId: "agenda-breakout-b", action: "add",
  });
  assert.deepEqual(addAgain.body.trainingSessions, ["agenda-breakout-b"]);

  // The counter trigger sees the change: seeded b=8, plus Quinn = 9.
  await waitFor(async () => {
    const meta = await db.collection("eventSessionCounts").doc(SUMMIT).get();
    return meta.data()?.counts?.["agenda-breakout-b"] === 9;
  }, {timeoutMs: 60000, intervalMs: 1000, label: "breakout-b count to reach 9"});

  const remove = await callHttp("update_my_sessions", {
    registrationId: regId, sessionId: "agenda-breakout-b", action: "remove",
  });
  assert.deepEqual(remove.body.trainingSessions, []);
  await waitFor(async () => {
    const meta = await db.collection("eventSessionCounts").doc(SUMMIT).get();
    return meta.data()?.counts?.["agenda-breakout-b"] === 8;
  }, {timeoutMs: 60000, intervalMs: 1000, label: "breakout-b count back to 8"});

  const notFound = await callHttp("update_my_sessions", {
    registrationId: "missing-reg", sessionId: "agenda-breakout-a", action: "add",
  });
  assert.equal(notFound.status, 404);
});

test("get_session_counts serves clamped per-session counts", async () => {
  const res = await callHttp("get_session_counts", {eventId: SUMMIT});
  assert.equal(res.status, 200);
  // Seeded: a=10, b=8, c=2 (this suite's own registrants added none that
  // survived - Quinn removed hers).
  assert.equal(res.body.counts["agenda-breakout-a"], 10);
  assert.equal(res.body.counts["agenda-breakout-b"], 8);
  assert.equal(res.body.counts["agenda-breakout-c"], 2);

  const bad = await callHttp("get_session_counts", {});
  assert.equal(bad.status, 400);
});
