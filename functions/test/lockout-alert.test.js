// Unit tests for the pure locked-out-patron alert logic (utils/lockout-alert).
// Pure functions only - no Firestore/Auth/emulator, same pattern as
// campaign-pure.test.js. Run via `npm test` (builds to lib/ first).
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {
  computeLockedOut,
  decideLockoutAlert,
  resolveRecipients,
  normalizeEmails,
  DEFAULT_ALERT_EMAIL,
  HEARTBEAT_MS,
} = require("../lib/utils/lockout-alert");

// ---- computeLockedOut -----------------------------------------------------

test("computeLockedOut: profiles without an Auth account are locked out",
    () => {
  const users = ["a@x.com", "b@x.com", "c@x.com"];
  const auth = ["b@x.com"];
  assert.deepEqual(computeLockedOut(users, auth), ["a@x.com", "c@x.com"]);
});

test("computeLockedOut: matching is case/whitespace-insensitive", () => {
  assert.deepEqual(
    computeLockedOut([" A@X.com ", "b@x.com"], ["a@x.com", "B@X.COM"]),
    [],
  );
});

test("computeLockedOut: excludes the non-person Play test artifact", () => {
  assert.deepEqual(
    computeLockedOut(["app_access@google.com", "real@x.com"], []),
    ["real@x.com"],
  );
});

test("computeLockedOut: everyone signed-in yields empty", () => {
  assert.deepEqual(computeLockedOut(["a@x.com"], ["a@x.com"]), []);
});

// ---- decideLockoutAlert ---------------------------------------------------

const NOW = 1_800_000_000_000;

test("first run establishes a silent baseline (never blasts the backlog)",
    () => {
  const d = decideLockoutAlert(["a@x.com", "b@x.com"], undefined, NOW);
  assert.equal(d.email, null);
  assert.deepEqual(d.nextState.known, ["a@x.com", "b@x.com"]);
});

test("a newly-appeared locked-out email triggers a 'new' alert", () => {
  const prev = {known: ["a@x.com"], lastAlertAt: NOW - 1000};
  const d = decideLockoutAlert(["a@x.com", "b@x.com"], prev, NOW);
  assert.ok(d.email);
  assert.equal(d.email.kind, "new");
  assert.deepEqual(d.email.newlyLockedOut, ["b@x.com"]);
  assert.deepEqual(d.email.allLockedOut, ["a@x.com", "b@x.com"]);
  assert.equal(d.nextState.lastAlertAt, NOW);
});

test("no new emails and inside the heartbeat window stays silent", () => {
  const prev = {known: ["a@x.com"], lastAlertAt: NOW - 1000};
  const d = decideLockoutAlert(["a@x.com"], prev, NOW);
  assert.equal(d.email, null);
  // known is refreshed, clock is preserved
  assert.deepEqual(d.nextState.known, ["a@x.com"]);
  assert.equal(d.nextState.lastAlertAt, NOW - 1000);
});

test("weekly heartbeat fires when a backlog persists past the window", () => {
  const prev = {known: ["a@x.com"], lastAlertAt: NOW - HEARTBEAT_MS - 1};
  const d = decideLockoutAlert(["a@x.com"], prev, NOW);
  assert.ok(d.email);
  assert.equal(d.email.kind, "heartbeat");
  assert.deepEqual(d.email.allLockedOut, ["a@x.com"]);
  assert.equal(d.nextState.lastAlertAt, NOW);
});

test("no heartbeat when the backlog has cleared", () => {
  const prev = {known: ["a@x.com"], lastAlertAt: NOW - HEARTBEAT_MS - 1};
  const d = decideLockoutAlert([], prev, NOW);
  assert.equal(d.email, null);
  assert.deepEqual(d.nextState.known, []);
});

test("a resolved-then-relapsed email re-alerts as new", () => {
  // baseline had a@x.com; they signed up (gone), so known refreshed to []
  const afterResolve = decideLockoutAlert(
      [], {known: ["a@x.com"], lastAlertAt: NOW}, NOW);
  assert.deepEqual(afterResolve.nextState.known, []);
  // later they are locked out again -> counts as new
  const relapse = decideLockoutAlert(
      ["a@x.com"], afterResolve.nextState, NOW + 1);
  assert.ok(relapse.email);
  assert.equal(relapse.email.kind, "new");
  assert.deepEqual(relapse.email.newlyLockedOut, ["a@x.com"]);
});

test("new alert wins even if the heartbeat window has also elapsed", () => {
  const prev = {known: ["a@x.com"], lastAlertAt: NOW - HEARTBEAT_MS - 1};
  const d = decideLockoutAlert(["a@x.com", "b@x.com"], prev, NOW);
  assert.equal(d.email.kind, "new");
});

// ---- resolveRecipients ----------------------------------------------------

test("resolveRecipients: blank falls back to the default", () => {
  assert.deepEqual(resolveRecipients(""), [DEFAULT_ALERT_EMAIL]);
  assert.deepEqual(resolveRecipients(undefined), [DEFAULT_ALERT_EMAIL]);
  assert.deepEqual(resolveRecipients("   "), [DEFAULT_ALERT_EMAIL]);
});

test("resolveRecipients: splits comma/semicolon lists and drops invalids",
    () => {
  assert.deepEqual(
    resolveRecipients("a@x.com, b@y.com ; not-an-email"),
    ["a@x.com", "b@y.com"],
  );
});

test("normalizeEmails: de-dupes, lowercases, sorts", () => {
  assert.deepEqual(
      normalizeEmails(["B@x.com", "a@x.com", "b@x.com"]),
      ["a@x.com", "b@x.com"]);
});
