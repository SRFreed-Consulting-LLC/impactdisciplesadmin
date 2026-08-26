// Writes the fake env/secret files the Functions emulator needs before it
// can load functions/lib. Both target files are gitignored (functions/
// .gitignore's *.local), so this runs as a pre-step of `npm run emu` every
// time rather than being committed - keeping the repo free of anything that
// even looks like a secret.
//
// Every value here is deliberately fake, and no emulator-backed test layer
// ever reaches a real vendor. PayPal, the apilayer tax service and
// ShipEngine are all REDIRECTED at scripts/fake-vendors.js by the
// FAKE_VENDOR_*_BASE vars below, so the paid checkout path, capture,
// refunds, the Georgia tax branch and even label purchase (which spends
// real postage) now run end to end against a stand-in. Anything NOT
// redirected (Stripe, YouTube) simply is not exercised; if one ever were,
// these fake keys would earn a 401 from the real vendor rather than doing
// anything.
//
// - functions/.env.local: plain process.env vars (loaded by the emulator
//   for any project, never used by `firebase deploy`).
// - functions/.secret.local: values for defineSecret() params (the
//   emulator's documented local-secrets override).

const fs = require("fs");
const path = require("path");

const functionsDir = path.join(__dirname, "..", "functions");

// The fake vendor server (scripts/fake-vendors.js) that PayPal, apilayer
// and ShipEngine calls are redirected to. One port, routed by path - see
// that file for why they cannot each have their own path prefix. The
// redirect itself is refused by functions/src/utils/vendor-hosts.ts
// anywhere that is not the emulator or a demo-* project, so these names
// are inert in a real deployment.
const FAKE_VENDORS_BASE =
  "http://127.0.0.1:" + (process.env.FAKE_VENDORS_PORT || 5055);

const ENV_VARS = {
  FAKE_VENDOR_PAYPAL_BASE: FAKE_VENDORS_BASE,
  FAKE_VENDOR_TAX_BASE: FAKE_VENDORS_BASE,
  FAKE_VENDOR_SHIPENGINE_BASE: FAKE_VENDORS_BASE,
  PAYPAL_CLIENT_SECRET: "fake-paypal-secret-emulator",
  STRIPE_SECRET_KEY: "sk_test_fake_emulator",
  SHIP_ENGINE_API_KEY: "fake-shipengine-key",
  GOOGLE_SECRET_KEY: "fake-google-key",
  YOUTUBE_PLAYLIST_KEY: "fake-playlist",
  TAX_API_KEY: "fake-tax-key",
  // The EMULATOR-backed web server (port rule: thousands digit = app,
  // last digit = backend, so web 4200 live-data / 4201 emulator). This
  // said 4200 until 2026-08-26, which is the dev-data server - a function
  // running under the emulator would have built links pointing a tester at
  // an app talking to impactdisciplesdev.
  WEB_APP_DOMAIN: "http://localhost:4201",
};

// Anything a function declares as a SECRET must appear here, even if the same
// name is already in ENV_VARS above - the emulator resolves the two through
// different channels. A secret that is missing from .secret.local is fetched
// from REAL Google Secret Manager, which 403s against the demo-* project and
// kills the functions worker on load; the symptom is every function failing
// with "Failed to load function" and every integration test hanging until it
// times out, which is what TAX_API_KEY did until 2026-08-21. Sources of truth
// for this list: defineSecret("...") calls and .runWith({secrets: [...]}).
const SECRETS = {
  PAYPAL_SANDBOX_CLIENT_SECRET: "fake-paypal-sandbox-secret",
  PAYPAL_LIVE_CLIENT_SECRET: "fake-paypal-live-secret",
  PAYPAL_CLIENT_SECRET: "fake-paypal-secret-emulator",
  ANTHROPIC_API_KEY: "fake-anthropic-key",
  // Declared via .runWith({secrets: [...]}) in paypal.functions.ts, not
  // defineSecret() - easy to miss when grepping for the latter.
  TAX_API_KEY: "fake-tax-key",
};

const toDotenv = (obj) =>
  Object.entries(obj).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";

fs.writeFileSync(path.join(functionsDir, ".env.local"), toDotenv(ENV_VARS));
fs.writeFileSync(path.join(functionsDir, ".secret.local"), toDotenv(SECRETS));
console.log("Wrote functions/.env.local and functions/.secret.local (fake emulator values).");
