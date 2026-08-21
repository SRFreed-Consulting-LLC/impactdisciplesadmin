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

/** Calls an onRequest HTTP function. Returns {status, body}. */
async function callHttp(name, body, headers = {}) {
  const res = await fetch(`${FN_BASE}/${name}`, {
    method: "POST",
    headers: {"Content-Type": "application/json", ...headers},
    body: JSON.stringify(body),
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
};
