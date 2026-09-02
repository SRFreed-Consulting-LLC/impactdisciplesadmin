import {tenantPath} from "../common/shared/lists/tenancy";
const ADMIN_USERS = tenantPath("admin_users");
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
import {DecodedIdToken, getAuth} from "firebase-admin/auth";
import {getFirestore} from "firebase-admin/firestore";
// The response half of an onRequest handler is express's, not one of
// firebase-functions' own types - v2 has no `functions.Response`, and its
// onRequest signature is (Request, express.Response) => void | Promise<void>.
import type {Response} from "express";

const ALLOWED_ORIGINS: readonly string[] = CORS_ALLOWED_ORIGINS;

type CorsCallback = (err: Error | null, allow?: boolean) => void;

const corsMiddleware = require("cors")({
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
 * Runs `handler` only when the request's Origin is allowed.
 *
 * This wrapper exists because the raw cors middleware FAILS OPEN in the shape
 * every call site used it. `cors@2.8.5` answers a rejected origin by calling
 * `next(err)` - and `next` was an argument-less arrow that discarded the
 * error, so the handler ran anyway and the only difference was a missing
 * Access-Control-Allow-Origin header. Worse on preflights: an ALLOWED origin
 * got a 204 and never reached the handler, while a DENIED origin ran the
 * handler on the OPTIONS request itself.
 *
 * The header comment above has always been right that this is not an auth
 * boundary - Origin is trivially spoofed outside a browser. But it also
 * claimed to stop drive-by abuse from other websites, and as implemented it
 * stopped nothing on any of the ~12 endpoints that use it. It does now.
 *
 * Deliberately keeps the old name and call signature so all existing call
 * sites are fixed without being edited, and so no future one can forget the
 * error argument - there is nowhere left to forget it.
 * @param {functions.https.Request} request The incoming request.
 * @param {Response} response The response - express's, not
 * firebase-functions', per the import note above.
 * @param {Function} handler What to run for an allowed origin.
 * @return {void} Nothing - onRequest handlers must return void|Promise<void>,
 * and the cors middleware discards whatever `next` returns anyway.
 */
export function restrictedCors(
  request: functions.https.Request,
  response: Response,
  handler: () => unknown
): void {
  corsMiddleware(request, response, (err?: Error) => {
    if (err) {
      response.status(403).send({error: "Origin not allowed"});
      return;
    }
    handler();
  });
}

/**
 * The roles that count as "business staff" - the same three
 * firestore.rules' isBusinessStaff() admits, deliberately.
 *
 * Editor is NOT here. That tier is library content only: firestore.rules
 * excludes it from isBusinessStaff ("their scope is the library only"),
 * nav-config hard-blocks Tools Manager for it, and PermissionService returns
 * NONE for every non-library screen key.
 */
export const BUSINESS_STAFF_ROLES: readonly string[] =
  ["Admin", "Root", "Employee"];

/**
 * Verifies the caller sent a valid Firebase Auth ID token belonging to a
 * staff user whose ROLE is in `allowedRoles`.
 *
 * Use this to gate functions that must only be callable from the
 * authenticated admin app (refunds, shipping label purchases, etc). Do NOT
 * use this on functions the public/guest checkout or unsubscribe flows need
 * to call -- those users never sign in.
 *
 * The role check is the point. This used to accept ANY admin_users row,
 * checking only that the query was non-empty - so an Editor, the
 * least-trusted staff tier, could sign in normally, take their ID token and
 * POST to get_shipping_label from the admin's own allowed origin, buying real
 * postage repeatably. Three layers already agreed an Editor must not reach
 * shipping; the one layer that spends money disagreed.
 *
 * Still matched on `email` rather than `firebaseUID`. requireAdminRole uses
 * firebaseUID, and matching the same immutable identity everywhere would be
 * better - but it is a separate change, because any admin_users row with an
 * unpopulated firebaseUID would start failing closed on a money path, and
 * that is not something to bundle into a security fix unverified.
 *
 * @param {functions.https.Request} request The request passed to an
 * onRequest handler.
 * @param {readonly string[]} allowedRoles Roles permitted to call. Defaults
 * to the three business-staff roles.
 * @return {Promise<DecodedIdToken>} The decoded, verified token.
 */
export async function requireStaffAuth(
  request: functions.https.Request,
  allowedRoles: readonly string[] = BUSINESS_STAFF_ROLES
): Promise<DecodedIdToken> {
  const authHeader: string = request.headers.authorization || "";
  const match = /^Bearer (.+)$/.exec(authHeader);

  if (!match) {
    throw new Error("Missing or malformed Authorization header");
  }

  const decoded = await getAuth().verifyIdToken(match[1]);

  const users = await getFirestore()
    .collection(ADMIN_USERS)
    .where("email", "==", decoded.email)
    .limit(1)
    .get();

  if (users.empty) {
    throw new Error("Caller is not a recognized staff user");
  }

  const role = users.docs[0].data()?.role;
  if (!allowedRoles.includes(role)) {
    throw new Error(
      `Caller role "${role ?? "none"}" is not permitted to call this function`
    );
  }

  return decoded;
}
