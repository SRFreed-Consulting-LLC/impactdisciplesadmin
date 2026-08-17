import {onCall, HttpsError} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {
  PaypalEnvironment,
  getAccessToken,
  getOrderCapture,
} from "./library-paypal";
import {applyStorePurchaseGrant} from "./library-store-license-grant";

/**
 * verifyAndGrantReaderStorePurchase - the reader app's own StoreComponent
 * checkout, PayPal-verified server-side; slated for retirement in Phase 5
 * when the in-app store goes away in favor of linking out to the web
 * store. (grantStorePurchaseLicenses, the shared-secret HTTP endpoint
 * that used to live here too, was retired in Phase 4 - the web store's
 * purchases trigger now grants directly in-process, see
 * library-license-grant.functions.ts.)
 *
 * As of 2026-08-17 this no longer writes ANY purchase record of its own -
 * the web store's `purchases` collection is the one system of record for
 * sales. The `purchaseId` stamped on granted licenses / returned to the
 * caller is the verified PayPal order id (or a synthesized token for the
 * $0 path), kept only so license provenance and the reader app's existing
 * response handling stay intact.
 *
 * `books` is nested (librarySeries/{s}/books/{b}), so existence checks
 * scan a `collectionGroup('books')` and match by doc id - same pattern
 * this app's own LibraryBookService.getById() uses.
 */
const libraryDb = admin.firestore();

const paypalSandboxSecret = defineSecret("PAYPAL_SANDBOX_CLIENT_SECRET");
const paypalLiveSecret = defineSecret("PAYPAL_LIVE_CLIENT_SECRET");

/**
 * Verifies and grants a reader-app patron's own individual book purchase
 * (StoreComponent's checkout).
 *
 * PayPal path (payPalOrderId present): fully verified here - the
 * captured amount/status is independently confirmed with PayPal before
 * any license is granted, same as purchaseGroupLicenses.
 *
 * Coupon/$0 path (no payPalOrderId): not verified here YET. (Historical:
 * coupons used to live in the legacy impactdisciples-a82a8 project, out
 * of this project's Admin SDK reach, making verification impossible;
 * since Phase 4 they live in this project's own `coupons` collection, so
 * server-side coupon verification is now buildable - just not built.)
 * Until then, rather than trust an unverified free claim, this grants
 * NOTHING automatically and logs the attempt for an admin to follow up
 * via the existing grantLibraryUserLicenses tool. No purchase record is
 * written on either path any more - see the top-of-file comment.
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
    // onPurchaseGrantLibraryLicenses uses, so a bogus id can't be
    // "granted" and silently do nothing forever. Same collectionGroup-
    // scan reasoning as there.
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
