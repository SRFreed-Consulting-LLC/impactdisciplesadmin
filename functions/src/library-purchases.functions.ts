import {timingSafeEqual} from "crypto";
import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {
  PaypalEnvironment,
  getAccessToken,
  getOrderCapture,
} from "./library-paypal";
import {
  applyStorePurchaseGrant,
  StoreBookGrant,
} from "./library-store-license-grant";

/**
 * Store-purchase license granting for the Impact Discipleship Library:
 * grantStorePurchaseLicenses (the bridge impactdisciples-web's
 * onPurchaseGrantLibraryLicenses trigger calls after a digital-book sale
 * in the real web store) and verifyAndGrantReaderStorePurchase (the
 * reader app's own StoreComponent checkout, PayPal-verified server-side;
 * slated for retirement in Phase 5 when the in-app store goes away in
 * favor of linking out to the web store).
 *
 * As of 2026-08-17 these no longer write ANY purchase record of their
 * own - the library's separate `purchases` collection (which lived on
 * the legacy named 'impactdiscipleship-books' database) is retired along
 * with that database; the web store's own `purchases` collection is the
 * one system of record for sales going forward. The `purchaseId` these
 * functions stamp on granted licenses / return to callers is now the
 * verified PayPal order id (or a synthesized token for the $0 path),
 * kept only so license provenance and the reader app's existing response
 * handling stay intact. revokePurchase (admin refund/revoke over those
 * old purchase records - never wired into this app's UI) was deleted at
 * the same time.
 *
 * `books` is nested (librarySeries/{s}/books/{b}), so existence checks
 * scan a `collectionGroup('books')` and match by doc id - same pattern
 * this app's own LibraryBookService.getById() uses.
 */
const libraryDb = admin.firestore();

const paypalSandboxSecret = defineSecret("PAYPAL_SANDBOX_CLIENT_SECRET");
const paypalLiveSecret = defineSecret("PAYPAL_LIVE_CLIENT_SECRET");
// Shared secret authenticating impactdisciples-web's store-purchase
// trigger to grantStorePurchaseLicenses below. Set the SAME value in both
// projects: firebase functions:secrets:set LIBRARY_GRANT_SECRET
const storeGrantSecret = defineSecret("LIBRARY_GRANT_SECRET");

/**
 * Grants book licenses for a digital-book purchase made in
 * impactdisciples-web's store. Called server-to-server by that project's
 * `onPurchaseGrantLibraryLicenses` purchases trigger (see this app's own
 * library-license-grant.functions.ts for why the grant crosses over
 * rather than being written there directly).
 *
 * onRequest rather than onCall: the caller is another project's Cloud
 * Function, not a signed-in client, so there is no Firebase Auth context
 * for onCall to check. Authenticated by a shared secret instead, compared
 * in constant time.
 *
 * Always answers 200 once the secret checks out, even when some or all
 * book ids are unknown here: the caller retries on non-2xx for up to 7
 * days, and a bad `digitalBookId` is a data problem no amount of
 * retrying fixes. Those ids come back in `unknown` and are logged so they
 * surface for an admin to investigate rather than vanishing into a 200.
 */
export const grantStorePurchaseLicenses = onRequest(
  {secrets: [storeGrantSecret], cors: false},
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({error: "POST required."});
      return;
    }

    const provided = String(req.get("x-library-grant-secret") ?? "");
    const expected = storeGrantSecret.value();
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(expected);
    // timingSafeEqual throws on a length mismatch, so guard on length
    // first - length is not the secret.
    const authorized =
      expectedBuf.length > 0 &&
      providedBuf.length === expectedBuf.length &&
      timingSafeEqual(providedBuf, expectedBuf);
    if (!authorized) {
      res.status(401).json({error: "Unauthorized."});
      return;
    }

    const body = (req.body ?? {}) as {
      email?: string;
      purchaseId?: string;
      books?: StoreBookGrant[];
    };
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const purchaseId =
      typeof body.purchaseId === "string" ? body.purchaseId.trim() : "";
    const books = Array.isArray(body.books) ?
      body.books.filter(
        (b): b is StoreBookGrant =>
          !!b && typeof b.bookId === "string" && !!b.bookId.trim()
      ) :
      [];

    if (!email || !purchaseId || books.length === 0) {
      res
        .status(400)
        .json({
          error: "email, purchaseId and a non-empty books array are required.",
        });
      return;
    }

    const uniqueBooks = [...new Map(books.map((b) => [b.bookId, b])).values()];
    // A bare book id doesn't say which series/book it's nested under -
    // scans every series' `books` subcollection once via a
    // collectionGroup query rather than one lookup per id. Fine at this
    // library's real scale (a handful of books total).
    const knownBookIds = new Set(
      (await libraryDb.collectionGroup("books").get()).docs.map((d) => d.id)
    );
    const known = uniqueBooks.filter((b) => knownBookIds.has(b.bookId));
    const unknown = uniqueBooks
      .filter((b) => !knownBookIds.has(b.bookId))
      .map((b) => b.bookId);

    if (unknown.length > 0) {
      logger.error("Store purchase referenced unknown book ids", {
        purchaseId,
        email,
        unknown,
      });
    }

    if (known.length === 0) {
      res.status(200).json({granted: [], skipped: [], unknown});
      return;
    }

    const ref = libraryDb.collection("libraryUsers").doc(email);
    const now = Date.now();
    let result = {granted: [] as string[], skipped: [] as string[]};
    await libraryDb.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      result = applyStorePurchaseGrant({
        transaction,
        recipientRef: ref,
        recipientSnap: snap,
        recipientEmail: email,
        books: known,
        purchaseId,
        now,
      });
    });

    logger.info("Granted store-purchase licenses", {
      purchaseId,
      email,
      granted: result.granted,
      skipped: result.skipped,
    });
    res.status(200).json({...result, unknown});
  }
);

/**
 * Verifies and grants a reader-app patron's own individual book purchase
 * (StoreComponent's checkout).
 *
 * PayPal path (payPalOrderId present): fully verified here - the
 * captured amount/status is independently confirmed with PayPal before
 * any license is granted, same as purchaseGroupLicenses.
 *
 * Coupon/$0 path (no payPalOrderId): CANNOT be verified here (coupon
 * records live in the legacy impactdisciples-a82a8 project, which this
 * project's Cloud Functions have no Admin SDK access to). Rather than
 * trust an unverifiable free claim, this grants NOTHING automatically
 * and logs the attempt for an admin to follow up via the existing
 * grantLibraryUserLicenses tool. No purchase record is written on either
 * path any more - see the top-of-file comment.
 */
export const verifyAndGrantReaderStorePurchase = onCall(
  {secrets: [paypalSandboxSecret, paypalLiveSecret], timeoutSeconds: 120},
  async (request) => {
    const email = request.auth?.token.email?.trim().toLowerCase();
    const uid = request.auth?.uid;
    if (!email || !uid) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }

    const {
      cartItems,
      total,
      couponCode,
      payPalOrderId,
      paypalEnvironment,
    } = (request.data ?? {}) as {
      cartItems?: Record<string, unknown>[];
      subtotal?: number;
      discount?: number;
      total?: number;
      couponCode?: string;
      payPalOrderId?: string;
      paypalEnvironment?: PaypalEnvironment;
    };

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      throw new HttpsError("invalid-argument", "cartItems is required.");
    }
    const bookIds = cartItems.map((item) =>
      typeof item["digitalBookId"] === "string" ?
        (item["digitalBookId"] as string).trim() :
        ""
    );
    if (bookIds.some((id) => !id)) {
      throw new HttpsError(
        "invalid-argument",
        "Every cart item needs a digitalBookId."
      );
    }

    // Confirm every claimed book actually exists here - same guard
    // grantStorePurchaseLicenses uses, so a bogus id can't be "granted"
    // and silently do nothing forever. Same collectionGroup-scan
    // reasoning as there.
    const uniqueBookIds = [...new Set(bookIds)];
    const knownBookIds = new Set(
      (await libraryDb.collectionGroup("books").get()).docs.map((d) => d.id)
    );
    const unknown = uniqueBookIds.filter((id) => !knownBookIds.has(id));
    if (unknown.length > 0) {
      throw new HttpsError(
        "invalid-argument",
        `Unknown book id(s): ${unknown.join(", ")}.`
      );
    }

    const now = Date.now();
    const claimedTotal = total ?? 0;
    // The PayPal order id doubles as the purchase's identity now that no
    // purchase doc is written - stamped on the granted licenses for
    // provenance and returned to the client, which already expects a
    // purchaseId field. The $0/coupon path gets a synthesized token (it
    // grants nothing automatically anyway - see below).
    const purchaseId = payPalOrderId ?? `unrecorded-${now}`;

    if (!payPalOrderId) {
      // Coupon/$0 claims can't be independently verified here - flag for
      // a human instead of auto-granting.
      logger.warn("Unverified $0/coupon purchase attempt - NOT auto-granted", {
        email,
        bookIds: uniqueBookIds,
        couponCode,
      });
      return {granted: false, purchaseId, pending: true};
    }

    const env: PaypalEnvironment = paypalEnvironment ?? "live";
    const clientSecret = (
      env === "sandbox" ? paypalSandboxSecret : paypalLiveSecret
    ).value();
    const accessToken = await getAccessToken(env, clientSecret);
    const capture = await getOrderCapture(env, accessToken, payPalOrderId);
    if (capture.status !== "COMPLETED") {
      throw new HttpsError(
        "failed-precondition",
        `PayPal order is not completed (status: ${capture.status}).`
      );
    }
    if (
      capture.currencyCode !== "USD" ||
      Math.abs(capture.amount - claimedTotal) > 0.01
    ) {
      throw new HttpsError(
        "failed-precondition",
        `PayPal payment (${capture.currencyCode} ${capture.amount}) ` +
          `does not match the claimed total ($${claimedTotal.toFixed(2)}).`
      );
    }

    const recipientRef = libraryDb.collection("libraryUsers").doc(email);
    let result: { granted: string[]; skipped: string[] } = {
      granted: [],
      skipped: [],
    };
    await libraryDb.runTransaction(async (transaction) => {
      const snap = await transaction.get(recipientRef);
      result = applyStorePurchaseGrant({
        transaction,
        recipientRef,
        recipientSnap: snap,
        recipientEmail: email,
        books: uniqueBookIds.map((bookId) => ({bookId})),
        purchaseId,
        now,
      });
    });

    return {
      granted: true,
      purchaseId,
      grantedBookIds: result.granted,
      skippedBookIds: result.skipped,
    };
  }
);
