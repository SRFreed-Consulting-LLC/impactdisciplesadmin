import {defineSecret} from "firebase-functions/params";

// Every Secret Manager secret the functions use, declared ONCE.
//
// Until 2026-09-05 half of these were declared with defineSecret() in the
// file that used them (three files each declared the two reader PayPal
// secrets) and the other half were bound by NAME - `secrets: ["X"]` on the
// function - and read back through process.env.X ?? "". The string form
// works, but a typo in the name, or a function that reads a secret it
// never bound, silently yields "" and the vendor call fails somewhere
// downstream with its own message. A param's .value() throws at the read
// instead, naming the secret, and the deploy checks the binding.
//
// Bind with `{secrets: [X]}` on the function; read with `X.value()` inside
// the handler (never at module load). The emulator takes values from
// functions/.secret.local, written by scripts/write-emulator-env.js - a
// secret added here must be added to that script's SECRETS list too, or
// every function fails to load under the emulator.
export const PAYPAL_SANDBOX_CLIENT_SECRET =
  defineSecret("PAYPAL_SANDBOX_CLIENT_SECRET");
export const PAYPAL_LIVE_CLIENT_SECRET =
  defineSecret("PAYPAL_LIVE_CLIENT_SECRET");
/** The WEB storefront's own PayPal app (paypal.functions.ts). */
export const PAYPAL_CLIENT_SECRET = defineSecret("PAYPAL_CLIENT_SECRET");
export const TAX_API_KEY = defineSecret("TAX_API_KEY");
export const SHIP_ENGINE_API_KEY = defineSecret("SHIP_ENGINE_API_KEY");
export const GOOGLE_SECRET_KEY = defineSecret("GOOGLE_SECRET_KEY");
export const YOUTUBE_PLAYLIST_KEY = defineSecret("YOUTUBE_PLAYLIST_KEY");
export const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
/** Signs the per-recipient unsubscribe links - utils/unsubscribe-token. */
export const UNSUBSCRIBE_TOKEN_SECRET =
  defineSecret("UNSUBSCRIBE_TOKEN_SECRET");
