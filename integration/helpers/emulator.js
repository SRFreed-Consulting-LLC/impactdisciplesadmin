// Shared harness for the emulator-backed integration suites. Everything in
// integration/ assumes the Emulator Suite is RUNNING (`npm run emu`) - the
// preflight() below fails fast with a clear message when it isn't. Tests
// run against the demo-impact project only; nothing here can reach a real
// Firebase project.
//
// Run order note: the suites share one emulator, and the seed is
// wipe-first - `npm run test:integration` runs files with
// --test-concurrency=1 so suites never interleave. Suites that mutate the
// seeded world reseed in before() (cheap: ~2s).

process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST || "localhost:9099";

const path = require("path");
const {execFileSync} = require("child_process");

const REPO_ROOT = path.join(__dirname, "..", "..");
const functionsDir = path.join(REPO_ROOT, "functions");
const {initializeApp} = require(
  require.resolve("firebase-admin/app", {paths: [functionsDir]})
);
const {getAuth} = require(
  require.resolve("firebase-admin/auth", {paths: [functionsDir]})
);
const firestoreSubpath = require(
  require.resolve("firebase-admin/firestore", {paths: [functionsDir]})
);

const PROJECT_ID = "demo-impact";
const FN_BASE = `http://127.0.0.1:5001/${PROJECT_ID}/us-central1`;

let app;
function getApp() {
  if (!app) {
    app = initializeApp({projectId: PROJECT_ID}, "integration-tests");
  }
  return app;
}

function getDb() {
  const db = firestoreSubpath.getFirestore(getApp());
  try {
    db.settings({ignoreUndefinedProperties: true});
  } catch {
    // settings() throws if already applied - fine.
  }
  return db;
}

/** Fails fast (with a how-to message) when the emulators aren't running. */
async function preflight() {
  try {
    const res = await fetch("http://127.0.0.1:4400/emulators");
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    throw new Error(
      "Emulator Suite is not running. Start it first: npm run emu " +
      "(then optionally npm run emu:seed), and re-run this suite."
    );
  }
}

/** Re-runs the wipe-first seed for a clean, known world. */
function reseed() {
  execFileSync(process.execPath,
    [path.join(REPO_ROOT, "scripts", "seed-emulator.js")],
    {stdio: "pipe"});
}

/** Calls an onRequest HTTP function. Returns {status, body}. POST with a
 *  JSON body by default; pass method "GET" for a link-style endpoint (the
 *  unsubscribe link), which sends no body. */
async function callHttp(name, body, headers = {}, method = "POST") {
  const res = await fetch(`${FN_BASE}/${name}`, {
    method,
    headers: {"Content-Type": "application/json", ...headers},
    ...(method === "GET" ? {} : {body: JSON.stringify(body)}),
  });
  let parsed = null;
  const text = await res.text();
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return {status: res.status, body: parsed};
}

/** Signs into the AUTH EMULATOR as a seeded user, returns an ID token. */
async function signIn(email, password = "test-password-1") {
  const res = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}` +
      "/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key",
    {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({email, password, returnSecureToken: true}),
    }
  );
  const data = await res.json();
  if (!data.idToken) {
    throw new Error(`Auth emulator sign-in failed for ${email}: ${JSON.stringify(data)}`);
  }
  return data.idToken;
}

/** Calls a CALLABLE function (onCall protocol). Returns {status, result, error}. */
async function callCallable(name, data, idToken) {
  const res = await fetch(`${FN_BASE}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? {Authorization: `Bearer ${idToken}`} : {}),
    },
    body: JSON.stringify({data}),
  });
  const body = await res.json().catch(() => ({}));
  return {status: res.status, result: body.result, error: body.error};
}

// ---------------------------------------------------------------------------
// Fake vendor server (scripts/fake-vendors.js)
//
// PayPal, the apilayer tax service and ShipEngine are redirected here by
// functions/.env.local, so the suites below can drive the paid checkout
// path, capture, refunds and label purchase - none of which could be run
// against the real vendors at all. `npm run emu` starts it; a suite that
// needs it calls preflightFakeVendors() so a missing server fails with a
// sentence instead of a wall of ECONNREFUSED.
// ---------------------------------------------------------------------------
const FAKE_VENDORS_PORT = Number(process.env.FAKE_VENDORS_PORT || 5055);
const FAKE_VENDORS_BASE = `http://127.0.0.1:${FAKE_VENDORS_PORT}`;

const fakeVendors = {
  /** Clears scenario overrides, remembered orders and the request log. */
  async reset() {
    const res = await fetch(`${FAKE_VENDORS_BASE}/__reset`, {method: "POST"});
    if (!res.ok) throw new Error(`fake-vendors reset failed: ${res.status}`);
  },
  /** Sets scenario knobs (see DEFAULTS in scripts/fake-vendors.js). An
   *  unknown key is rejected rather than silently ignored, so a typo fails
   *  as a typo instead of as a product bug. */
  async control(patch) {
    const res = await fetch(`${FAKE_VENDORS_BASE}/__control`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(patch),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(`fake-vendors control rejected: ${JSON.stringify(body)}`);
    }
    return body.scenario;
  },
  /** Every vendor request served since the last reset - lets a test assert
   *  on what we SENT, which is otherwise invisible from Firestore alone. */
  async log(vendor) {
    const res = await fetch(`${FAKE_VENDORS_BASE}/__log`);
    const {requests} = await res.json();
    return vendor ? requests.filter((r) => r.vendor === vendor) : requests;
  },
  /** The orders the fake PayPal currently knows about. */
  async orders() {
    const res = await fetch(`${FAKE_VENDORS_BASE}/__orders`);
    return (await res.json()).orders;
  },
};

/** Fails fast (with a how-to message) when the fake vendor server is down. */
async function preflightFakeVendors() {
  try {
    const res = await fetch(`${FAKE_VENDORS_BASE}/__health`);
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    throw new Error(
      `Fake vendor server is not running on port ${FAKE_VENDORS_PORT}. It ` +
      "starts with the emulator (npm run emu); to run it alone: " +
      "npm run fake-vendors."
    );
  }
}

/** Polls until fn() is truthy (for Firestore-trigger side effects). */
async function waitFor(fn, {timeoutMs = 20000, intervalMs = 400, label = "condition"} = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

module.exports = {
  PROJECT_ID, FN_BASE,
  getAuth, getApp, getDb,
  preflight, reseed, callHttp, callCallable, signIn, waitFor,
  FAKE_VENDORS_BASE, fakeVendors, preflightFakeVendors,
};
