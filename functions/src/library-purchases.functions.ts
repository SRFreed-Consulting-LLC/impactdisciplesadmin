import {timingSafeEqual} from "crypto";
import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import {getFirestore} from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {requireAdminRole} from "./admin-users.functions";
import {
  PaypalEnvironment,
  getAccessToken,
  getCaptureId,
  getOrderCapture,
  refundCapture,
} from "./library-paypal";
import {
  applyStorePurchaseGrant,
  StoreBookGrant,
} from "./library-store-license-grant";

/**
 * Ported from impact-discipleship-library-manager-new's own purchase-
 * related Cloud Functions (functions/src/index.ts): revokePurchase (admin
 * refund/revoke of a reader-app PayPal book purchase),
 * grantStorePurchaseLicenses (the cross-project bridge
 * library-license-grant.functions.ts's onPurchaseGrantLibraryLicenses
 * calls to actually grant a license after a impactdisciples-web store
 * purchase), and verifyAndGrantReaderStorePurchase (the reader app's own
 * StoreComponent checkout, PayPal-verified server-side). All three
 * operate on the named 'impactdiscipleship-books' database's `purchases`
 * collection - a DIFFERENT collection from this project's own native
 * `purchases` (store orders); see the consolidation plan's Phase 3 note
 * on why the named database's `purchases` is headed for archival, not a
 * live migration.
 *
 * revokePurchase's admin check is adapted from the source's own
 * requireAdmin (which checked the legacy, named-database `adminUsers`
 * collection) to this app's own requireAdminRole (admin_users) - matches
 * every other admin-facing Library function already ported (Library
 * Users, Groups). grantStorePurchaseLicenses/verifyAndGrantReaderStorePurchase
 * need no such check - the former authenticates via a shared secret (a
 * cross-project server call, no Firebase Auth context at all), the
 * latter via the calling patron's own Firebase Auth session.
 */
const libraryDb = getFirestore(admin.app(), "impactdiscipleship-books");

const paypalSandboxSecret = defineSecret("PAYPAL_SANDBOX_CLIENT_SECRET");
const paypalLiveSecret = defineSecret("PAYPAL_LIVE_CLIENT_SECRET");
// Shared secret authenticating impactdisciples-web's store-purchase
// trigger to grantStorePurchaseLicenses below. Set the SAME value in both
// projects: firebase functions:secrets:set LIBRARY_GRANT_SECRET
const storeGrantSecret = defineSecret("LIBRARY_GRANT_SECRET");

interface PurchaseRevocation {
  /** digitalBookIds revoked together in this one call - a single admin
   *  action, possibly covering more than one book. */
  bookIds: string[];
  revokedAt: number;
  /** uid of the admin who performed this specific revoke. */
  revokedBy: string;
  /** PayPal's refund id, set only when this action actually called
   *  PayPal's refund API. */
  paypalRefundId?: string;
  /** Dollar amount refunded via PayPal for this action specifically
   *  (partial for a partial revoke) - absent whenever paypalRefundId is
   *  absent. */
  refundedAmount?: number;
}

/**
 * Revokes one or more books from a Store purchase (impact-discipleship-
 * library-new) and, unless the caller opts out or there's nothing to
 * refund, actually refunds the customer via PayPal's REST API. Removes
 * the revoked book(s) from the purchasing patron's
 * libraryUsers/{email}.bookLicenses/licensedBookIds and appends an entry
 * to the purchase doc's `revocations` array (rather than overwriting a
 * single "last revoked" snapshot) so a bundled purchase can get partially
 * refunded in more than one action.
 *
 * The PayPal call (when made) happens *before* any Firestore write - if
 * it fails, nothing else in this function runs, so a customer never
 * loses book access for a refund that didn't actually happen.
 */
export const revokePurchase = onCall(
  // Explicit timeout (default is 60s): up to three sequential PayPal HTTP
  // round trips (auth, order lookup, refund) happen before the Firestore
  // transaction even starts.
  {secrets: [paypalSandboxSecret, paypalLiveSecret], timeoutSeconds: 120},
  async (request) => {
    await requireAdminRole(request.auth?.uid);

    const {purchaseId, bookIds, refundViaPaypal} = (request.data ?? {}) as {
      purchaseId?: string;
      bookIds?: string[];
      refundViaPaypal?: boolean;
    };
    if (!purchaseId) {
      throw new HttpsError("invalid-argument", "purchaseId is required.");
    }

    const purchaseRef = libraryDb.collection("purchases").doc(purchaseId);
    const purchaseSnap = await purchaseRef.get();
    if (!purchaseSnap.exists) {
      throw new HttpsError("not-found", "Purchase not found.");
    }
    const purchase = purchaseSnap.data() as {
      email: string;
      receipt: string;
      cartItems: { digitalBookId: string; discountPrice: number }[];
      revocations?: PurchaseRevocation[];
      paypalEnvironment?: PaypalEnvironment;
      paypalCaptureId?: string;
      correlationId?: string;
    };

    const allBookIds = purchase.cartItems.map((item) => item.digitalBookId);
    const priorRevocations = purchase.revocations ?? [];
    const alreadyRevoked = new Set(priorRevocations.flatMap((r) => r.bookIds));
    // Ignore any requested id that isn't actually part of this purchase
    // or was already revoked in an earlier partial-refund call, rather
    // than erroring - lets the client just re-send "everything the admin
    // checked" without having to track what a prior call already did.
    const toRevoke = (bookIds?.length ? bookIds : allBookIds).filter(
      (id) => allBookIds.includes(id) && !alreadyRevoked.has(id)
    );
    if (toRevoke.length === 0) {
      throw new HttpsError(
        "failed-precondition",
        "Nothing to revoke - selected book(s) already refunded."
      );
    }

    // Nothing to refund via PayPal for a purchase no money was ever
    // collected for (a 100%-off coupon, or the $0 "Get Books" path) - and
    // the admin may have already refunded manually in PayPal's own
    // dashboard before using this tool.
    const skipsPaypal =
      refundViaPaypal === false ||
      purchase.receipt === "COUPON" ||
      purchase.receipt === "FREE ONLY";

    let paypalRefundId: string | undefined;
    let refundedAmount: number | undefined;
    let newlyResolvedCaptureId: string | undefined;

    if (!skipsPaypal) {
      // Pre-existing purchases predate this field entirely - default to
      // 'live' rather than silently skipping a real refund; a mismatched
      // environment just fails cleanly below.
      const env: PaypalEnvironment = purchase.paypalEnvironment ?? "live";
      const clientSecret = (
        env === "sandbox" ? paypalSandboxSecret : paypalLiveSecret
      ).value();

      let accessToken: string;
      try {
        accessToken = await getAccessToken(env, clientSecret);
      } catch {
        throw new HttpsError("internal", "Could not authenticate with PayPal.");
      }

      let captureId = purchase.paypalCaptureId;
      if (!captureId) {
        try {
          captureId = await getCaptureId(env, accessToken, purchase.receipt);
        } catch {
          throw new HttpsError(
            "not-found",
            "Could not find a matching PayPal payment for this purchase."
          );
        }
        newlyResolvedCaptureId = captureId;
      }

      // Only omit the amount (full remaining refund) for a single
      // one-shot full revoke - any other case sends an explicit amount
      // for just this call's books, so a prior action's already-refunded
      // amount is never refunded again.
      const isSingleFullRevoke =
        priorRevocations.length === 0 && toRevoke.length === allBookIds.length;
      const amount = isSingleFullRevoke ?
        undefined :
        purchase.cartItems
          .filter((item) => toRevoke.includes(item.digitalBookId))
          .reduce((sum, item) => sum + item.discountPrice, 0);

      // Deterministic (not random) so a genuine retry of the exact same
      // action reuses PayPal's own idempotency window instead of risking
      // a second refund if this function dies after the PayPal call but
      // before the Firestore write below.
      const idempotencyKey =
        `revoke-${purchaseId}-${[...toRevoke].sort().join("_")}`;

      try {
        const refund = await refundCapture(
          env,
          accessToken,
          captureId,
          amount,
          idempotencyKey
        );
        paypalRefundId = refund.id;
        refundedAmount =
          amount ??
          purchase.cartItems.reduce((sum, item) => sum + item.discountPrice, 0);
      } catch (err) {
        throw new HttpsError(
          "failed-precondition",
          err instanceof Error ? err.message : "PayPal refund failed."
        );
      }
    }

    const email = purchase.email.trim().toLowerCase();
    const libraryUserRef = libraryDb.collection("libraryUsers").doc(email);

    // The PayPal refund above can't itself be part of a Firestore
    // transaction, so re-read both docs fresh here rather than trusting
    // purchaseSnap/the pre-refund toRevoke check - two concurrent revoke
    // calls on the same purchase would otherwise each compute their
    // array update from stale data and one write would silently clobber
    // the other's revocation record.
    let fullyRefunded = false;
    await libraryDb.runTransaction(async (transaction) => {
      const [freshPurchaseSnap, freshLibraryUserSnap] = await Promise.all([
        transaction.get(purchaseRef),
        transaction.get(libraryUserRef),
      ]);
      if (!freshPurchaseSnap.exists) {
        throw new HttpsError("not-found", "Purchase not found.");
      }
      const freshPriorRevocations =
        (freshPurchaseSnap.data() as { revocations?: PurchaseRevocation[] })
          .revocations ?? [];
      const freshAlreadyRevoked = new Set(
        freshPriorRevocations.flatMap((r) => r.bookIds)
      );
      if (toRevoke.some((id) => freshAlreadyRevoked.has(id))) {
        throw new HttpsError(
          "aborted",
          "This purchase was modified by another action while this " +
            "refund was processing. If a PayPal refund was issued " +
            "above, check the purchase's revocation history before " +
            "retrying."
        );
      }

      const revocations: PurchaseRevocation[] = [
        ...freshPriorRevocations,
        {
          bookIds: toRevoke,
          revokedAt: Date.now(),
          revokedBy: request.auth!.uid,
          ...(paypalRefundId ? {paypalRefundId, refundedAmount} : {}),
        },
      ];
      fullyRefunded = allBookIds.every((id) =>
        revocations.some((r) => r.bookIds.includes(id))
      );
      transaction.update(purchaseRef, {
        revocations,
        processedStatus: fullyRefunded ? "REFUNDED" : "NEW",
        ...(newlyResolvedCaptureId ?
          {paypalCaptureId: newlyResolvedCaptureId} :
          {}),
      });

      if (freshLibraryUserSnap.exists) {
        const revokeSet = new Set(toRevoke);
        const data = freshLibraryUserSnap.data() as {
          bookLicenses?: { bookId: string; source?: string }[];
          licensedBookIds?: string[];
        };
        // Only purchase-origin bookLicenses entries (no `source` field)
        // belong to this refund path. A group- or admin-sourced license
        // for the same book must survive the refund, so the flat
        // licensedBookIds entry is only dropped when no remaining entry
        // still covers that book.
        const allLicenses = Array.isArray(data.bookLicenses) ?
          data.bookLicenses :
          [];
        const bookLicenses = allLicenses.filter(
          (license) => !(revokeSet.has(license.bookId) && !license.source)
        );
        const priorIds = Array.isArray(data.licensedBookIds) ?
          data.licensedBookIds :
          [];
        const licensedBookIds = priorIds.filter(
          (id) =>
            !revokeSet.has(id) ||
            bookLicenses.some((license) => license.bookId === id)
        );
        transaction.update(libraryUserRef, {
          bookLicenses,
          licensedBookIds,
          updatedAt: Date.now(),
        });
      }
    });

    return {
      revokedBookIds: toRevoke,
      fullyRefunded,
      paypalRefundId,
      refundedAmount,
    };
  }
);

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
    const bookSnaps = await Promise.all(
      uniqueBooks.map((b) => libraryDb.collection("books").doc(b.bookId).get())
    );
    const known = uniqueBooks.filter((_, i) => bookSnaps[i].exists);
    const unknown = uniqueBooks
      .filter((_, i) => !bookSnaps[i].exists)
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
 * Verifies and records a reader-app patron's own individual book purchase
 * (StoreComponent's checkout).
 *
 * PayPal path (payPalOrderId present): fully verified here - the
 * captured amount/status is independently confirmed with PayPal before
 * any license is granted, same as purchaseGroupLicenses.
 *
 * Coupon/$0 path (no payPalOrderId): CANNOT be verified here today.
 * Coupon records live in the legacy impactdisciples-a82a8 project's
 * default database, which this project's Cloud Functions have no Admin
 * SDK access to. Rather than trust an unverifiable free claim, this
 * records the attempted purchase as pending and grants NOTHING
 * automatically - an admin follows up via the existing
 * grantLibraryUserLicenses tool.
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
      subtotal,
      discount,
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
    // and silently do nothing forever.
    const uniqueBookIds = [...new Set(bookIds)];
    const bookSnaps = await Promise.all(
      uniqueBookIds.map((id) => libraryDb.collection("books").doc(id).get())
    );
    const unknown = uniqueBookIds.filter((_, i) => !bookSnaps[i].exists);
    if (unknown.length > 0) {
      throw new HttpsError(
        "invalid-argument",
        `Unknown book id(s): ${unknown.join(", ")}.`
      );
    }

    const now = Date.now();
    const claimedTotal = total ?? 0;
    const receipt = payPalOrderId ?? (couponCode ? "COUPON" : "FREE ONLY");

    let verifiedCaptureId: string | undefined;
    let granted = false;

    if (payPalOrderId) {
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
      verifiedCaptureId = capture.captureId;
      granted = true;
    }

    const purchaseRef = libraryDb.collection("purchases").doc();
    await purchaseRef.set({
      email,
      userId: uid,
      cartItems,
      ...(couponCode ? {couponCode} : {}),
      subtotal: subtotal ?? 0,
      discount: discount ?? 0,
      total: claimedTotal,
      receipt,
      processedStatus: granted ? "NEW" : "PENDING_MANUAL_REVIEW",
      dateProcessed: now,
      createdAt: now,
      ...(verifiedCaptureId ? {paypalCaptureId: verifiedCaptureId} : {}),
      ...(payPalOrderId ?
        {paypalEnvironment: paypalEnvironment ?? "live"} :
        {}),
    });

    if (!granted) {
      // Coupon/$0 claims can't be independently verified here yet - flag
      // for a human instead of auto-granting.
      logger.warn("Unverified $0/coupon purchase recorded - NOT auto-granted", {
        purchaseId: purchaseRef.id,
        email,
        bookIds: uniqueBookIds,
        couponCode,
      });
      return {granted: false, purchaseId: purchaseRef.id, pending: true};
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
        purchaseId: purchaseRef.id,
        now,
      });
    });

    return {
      granted: true,
      purchaseId: purchaseRef.id,
      grantedBookIds: result.granted,
      skippedBookIds: result.skipped,
    };
  }
);
