// Writes the fake env/secret files the Functions emulator needs before it
// can load functions/lib. Both target files are gitignored (functions/
// .gitignore's *.local), so this runs as a pre-step of `npm run emu` every
// time rather than being committed - keeping the repo free of anything that
// even looks like a secret.
//
// Every value here is deliberately fake. The emulator-backed test layers
// never call a real vendor: the free-order checkout path returns before any
// PayPal call, Mailchimp sync is gated behind an integration_settings doc
// the seed doesn't create, and Stripe/ShipEngine/YouTube endpoints aren't
// exercised. Functions that DO reach their vendor with these values get a
// 401 from the vendor - which is itself what the paid-path boundary tests
// assert on.
//
// - functions/.env.local: plain process.env vars (loaded by the emulator
//   for any project, never used by `firebase deploy`).
// - functions/.secret.local: values for defineSecret() params (the
//   emulator's documented local-secrets override).

const fs = require("fs");
const path = require("path");

const functionsDir = path.join(__dirname, "..", "functions");

const ENV_VARS = {
  PAYPAL_CLIENT_SECRET: "fake-paypal-secret-emulator",
  STRIPE_SECRET_KEY: "sk_test_fake_emulator",
  SHIP_ENGINE_API_KEY: "fake-shipengine-key",
  GOOGLE_SECRET_KEY: "fake-google-key",
  YOUTUBE_PLAYLIST_KEY: "fake-playlist",
  TAX_API_KEY: "fake-tax-key",
  MAILCHIMP_API_KEY: "fake-mailchimp-key-us1",
  WEB_APP_DOMAIN: "http://localhost:4200",
};

const SECRETS = {
  PAYPAL_SANDBOX_CLIENT_SECRET: "fake-paypal-sandbox-secret",
  PAYPAL_LIVE_CLIENT_SECRET: "fake-paypal-live-secret",
  PAYPAL_CLIENT_SECRET: "fake-paypal-secret-emulator",
  ANTHROPIC_API_KEY: "fake-anthropic-key",
};

const toDotenv = (obj) =>
  Object.entries(obj).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";

fs.writeFileSync(path.join(functionsDir, ".env.local"), toDotenv(ENV_VARS));
fs.writeFileSync(path.join(functionsDir, ".secret.local"), toDotenv(SECRETS));
console.log("Wrote functions/.env.local and functions/.secret.local (fake emulator values).");
