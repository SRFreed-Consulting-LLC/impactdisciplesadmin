/* eslint-disable @typescript-eslint/no-var-requires */
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
const ALLOWED_ORIGINS = [
  // impactdisciples-web, production (custom domain + Firebase-assigned)
  "https://impactdisciples.com",
  "https://www.impactdisciples.com",
  "https://impactdisciples-public.web.app",
  "https://impactdisciples-public.firebaseapp.com",
  // impactdisciples-web, dev
  "https://impactdisciplesdev-public.web.app",
  "https://impactdisciplesdev-public.firebaseapp.com",
  // impactdisciples-admin, production
  "https://impactdisciples-admin.web.app",
  "https://impactdisciples-admin.firebaseapp.com",
  // impactdisciples-admin, dev
  "https://impactdisciplesdev-admin.web.app",
  "https://impactdisciplesdev-admin.firebaseapp.com",
  // local development
  "http://localhost:4200",
  "http://localhost:5200",
];

type CorsCallback = (err: Error | null, allow?: boolean) => void;

export const restrictedCors = require("cors")({
  origin: (origin: string, callback: CorsCallback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
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
