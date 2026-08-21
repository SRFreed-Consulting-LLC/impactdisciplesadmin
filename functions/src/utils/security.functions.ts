import * as admin from "firebase-admin";
import * as functions from "firebase-functions";

// Known origins allowed to call these HTTP functions from a browser. Update
// this list if a new hosting domain (prod/dev/admin) is added.
//
// IMPORTANT: this is a browser-enforced mechanism only (the Origin header is
// trivial to spoof from curl/Postman/server-side scripts). It stops drive-by
// abuse from other websites, but it is not an auth boundary -- functions
// that move money or delete data must also call requireStaffAuth() below.
// These are the actual Firebase Hosting site names declared in each app's
// .firebaserc (targets.*.hosting), not guesses -- verify there against
// `firebase hosting:sites:list` before adding/removing an entry.
// The browser origins allowed to call the HTTP functions - ONE list for the
// whole suite, in the shared submodule (src/common/src/shared/config/
// firebase-projects.ts, copied in by scripts/sync-shared.js as part of the
// build). Add a hosting site there, not here.
import {CORS_ALLOWED_ORIGINS} from "../common/shared/config/firebase-projects";

const ALLOWED_ORIGINS: readonly string[] = CORS_ALLOWED_ORIGINS;

type CorsCallback = (err: Error | null, allow?: boolean) => void;

export const restrictedCors = require("cors")({
  origin: (origin: string, callback: CorsCallback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  // Access-Control-Max-Age: without it, EVERY JSON POST from the browser is
  // preceded by an OPTIONS preflight that also invokes (and can cold-start)
  // the function - on the storefront checkout that doubled the round trips
  // on get_shipping_rates and create_paypal_order. One hour lets a checkout
  // session preflight each endpoint once.
  maxAge: 3600,
});

/**
 * Verifies the caller sent a valid Firebase Auth ID token belonging to a
 * recognized staff user (has an AdminUser record in the "admin_users"
 * collection). Throws if the token is missing, invalid/expired, or the
 * user isn't staff.
 *
 * Use this to gate functions that must only be callable from the
 * authenticated admin app (refunds, shipping label purchases, etc). Do NOT
 * use this on functions the public/guest checkout or unsubscribe flows need
 * to call -- those users never sign in.
 *
 * @param {functions.https.Request} request The request passed to an
 * onRequest handler.
 * @return {Promise<admin.auth.DecodedIdToken>} The decoded, verified token.
 */
export async function requireStaffAuth(
  request: functions.https.Request
): Promise<admin.auth.DecodedIdToken> {
  const authHeader: string = request.headers.authorization || "";
  const match = /^Bearer (.+)$/.exec(authHeader);

  if (!match) {
    throw new Error("Missing or malformed Authorization header");
  }

  const decoded = await admin.auth().verifyIdToken(match[1]);

  const users = await admin.firestore()
    .collection("admin_users")
    .where("email", "==", decoded.email)
    .limit(1)
    .get();

  if (users.empty) {
    throw new Error("Caller is not a recognized staff user");
  }

  return decoded;
}
