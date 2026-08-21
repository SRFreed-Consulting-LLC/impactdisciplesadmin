import {onCall, HttpsError} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";
import {requireAdminRole} from "./admin-users.functions";
import {
  PaypalEnvironment,
  getAccessToken,
  getCaptureId,
  refundCapture,
} from "./library-paypal";
import {
  RefundStorePurchaseRequest,
  RefundStorePurchaseResult,
  RevokeStorePurchasedLicenseRequest,
  RevokeStorePurchasedLicenseResult,
} from "./common/shared/contract/admin-callables.types";

// Pre-prod hardening #6: the missing refund->revoke symmetry. Until now a
// refunded digital-book purchase kept its library access forever (grant
// side existed - onPurchaseGrantLibraryLicenses - but nothing ever took a
// license away). refundStorePurchase refunds the PayPal capture AND
// (admin's choice, default yes - "ask at refund time") strips exactly the
// license entries that purchase granted. revokeStorePurchasedLicense is
// the manual sibling for stripping a store-purchased license without a
// refund (mirror of revokeAdminGrantedLicense, which only handles
// source === 'admin-grant').

const paypalSandboxSecret = defineSecret("PAYPAL_SANDBOX_CLIENT_SECRET");
const paypalLiveSecret = defineSecret("PAYPAL_LIVE_CLIENT_SECRET");
// The web storefront's own PayPal app secret (paypal.functions.ts) - a
// capture made by that app must be refunded with that app's credentials.
const webPaypalSecret = defineSecret("PAYPAL_CLIENT_SECRET");

// The Firestore handle is taken inside each function rather than at module
// load (same as campaign-admin.functions.ts): a module-level
// admin.firestore() throws "default Firebase app does not exist" the moment
// anything requires this file without initializing the SDK first - which is
// exactly what the pure-unit suite (test/store-refund.test.js) does.

const WEB_API_HOST: Record<PaypalEnvironment, string> = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
};

/**
 * OAuth token using explicit client id + secret - needed for the web
 * storefront's PayPal app, whose client id lives in the `config`
 * collection rather than library-paypal.ts's hardcoded map.
 * @param {PaypalEnvironment} env Which PayPal environment to hit.
 * @param {string} clientId The PayPal app's client id.
 * @param {string} clientSecret The PayPal app's client secret.
 * @return {Promise<string>} A bearer access token.
 */
async function getTokenWithCreds(
  env: PaypalEnvironment,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(`${WEB_API_HOST[env]}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const body = (await response.json()) as {access_token?: string};
  if (!response.ok || !body.access_token) {
    throw new Error("PayPal auth failed for web storefront app");
  }
  return body.access_token;
}

interface RefundEntryDoc {
  amount: number;
  date: Timestamp;
  by?: string;
  refundId?: string;
  refundStatus?: string;
  licensesRevoked?: string[];
}

interface StatusHistoryEntryDoc {
  status: string;
  date: Timestamp;
  by?: string;
}

interface PurchaseDoc {
  email?: string;
  total?: number;
  discount?: number;
  receipt?: string;
  refunded?: boolean;
  refundAmount?: number;
  refunds?: RefundEntryDoc[];
  fulfillmentStatus?: string;
  statusHistory?: StatusHistoryEntryDoc[];
  paypalEnvironment?: string;
  payPalReceipt?: {
    purchase_units?: Array<{amount?: {value?: string}}>;
  };
  cartItems?: Array<{
    isDigitalBook?: boolean;
    digitalBookId?: string;
  }>;
}

/**
 * What the buyer was actually charged, in CENTS (all refund math is done
 * in integer cents for float safety). Server-side twin of the client's
 * PurchasesService.getChargedDisplayAmount(): prefer the PayPal receipt's
 * captured value, fall back to total - discount.
 * @param {PurchaseDoc} purchase The purchase doc.
 * @return {number} Charged amount in cents (never negative).
 */
export function chargedCents(purchase: PurchaseDoc): number {
  const receiptValue =
    purchase.payPalReceipt?.purchase_units?.[0]?.amount?.value;
  if (typeof receiptValue === "string" && !isNaN(parseFloat(receiptValue))) {
    return Math.max(0, Math.round(parseFloat(receiptValue) * 100));
  }
  const charged = (purchase.total ?? 0) - (purchase.discount ?? 0);
  return Math.max(0, Math.round(charged * 100));
}

export interface RefundPlan {
  requestedCents: number;
  remainingCents: number;
  isFullRefund: boolean;
}

/**
 * Pure guard/arithmetic core of the refund flow, extracted for unit
 * testing. Throws HttpsError on any invalid request.
 * @param {PurchaseDoc} purchase The purchase doc.
 * @param {number | null | undefined} amountDollars The admin-entered
 *   partial amount in dollars; null/undefined means "the full remainder".
 * @param {boolean} needsPaypalRefund Whether a real PayPal refund happens
 *   ($0/coupon orders can only be marked fully refunded).
 * @return {RefundPlan} The validated plan.
 */
export function computeRefundPlan(
  purchase: PurchaseDoc,
  amountDollars: number | null | undefined,
  needsPaypalRefund: boolean
): RefundPlan {
  const charged = chargedCents(purchase);
  const alreadyRefunded =
    Math.max(0, Math.round((purchase.refundAmount ?? 0) * 100));
  const remainingCents = charged - alreadyRefunded;

  if (purchase.refunded === true || (charged > 0 && remainingCents <= 0)) {
    throw new HttpsError(
      "failed-precondition", "This purchase was already fully refunded."
    );
  }

  const requestedCents = amountDollars == null ?
    remainingCents :
    Math.round(amountDollars * 100);

  if (!needsPaypalRefund) {
    // Nothing was charged through PayPal - the only sensible operation is
    // "mark the whole order refunded"; a partial dollar amount against a
    // $0/coupon charge is a mistake.
    if (amountDollars != null && requestedCents !== remainingCents) {
      throw new HttpsError(
        "invalid-argument",
        "This order has no PayPal charge - only a full refund is possible."
      );
    }
    return {
      requestedCents: remainingCents,
      remainingCents,
      isFullRefund: true,
    };
  }

  if (requestedCents <= 0 || requestedCents > remainingCents) {
    throw new HttpsError(
      "invalid-argument",
      "Refund amount must be between $0.01 and " +
        `$${(remainingCents / 100).toFixed(2)}.`
    );
  }

  return {
    requestedCents,
    remainingCents,
    isFullRefund: requestedCents === remainingCents,
  };
}

/**
 * Strips every `source: 'store-purchase'` license entry this purchase
 * granted from the buyer's libraryUsers doc. A flat licensedBookIds entry
 * is only dropped when no remaining bookLicenses entry still covers the
 * book - identical merge semantics to revokeAdminGrantedLicense.
 * @param {string} email Buyer email (doc id in libraryUsers).
 * @param {string} purchaseId The purchase whose grants to strip.
 * @param {string | undefined} onlyBookId Restrict to one book (manual
 *   tool); undefined strips all of the purchase's grants (refund path).
 * @return {Promise<string[]>} The bookIds whose entries were removed.
 */
async function stripStorePurchaseLicenses(
  email: string,
  purchaseId: string | undefined,
  onlyBookId?: string
): Promise<string[]> {
  const db = admin.firestore();
  const ref = db.collection("libraryUsers").doc(email);
  const removedIds: string[] = [];
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) {
      return;
    }
    const data = snap.data() as {
      bookLicenses?: Record<string, unknown>[];
      licensedBookIds?: string[];
    };
    const allLicenses = Array.isArray(data.bookLicenses) ?
      data.bookLicenses :
      [];
    const bookLicenses = allLicenses.filter((license) => {
      const matches =
        license["source"] === "store-purchase" &&
        (purchaseId === undefined ||
          license["storePurchaseId"] === purchaseId) &&
        (onlyBookId === undefined || license["bookId"] === onlyBookId);
      if (matches && typeof license["bookId"] === "string") {
        removedIds.push(license["bookId"]);
      }
      return !matches;
    });
    if (bookLicenses.length === allLicenses.length) {
      return;
    }
    const priorIds = Array.isArray(data.licensedBookIds) ?
      data.licensedBookIds :
      undefined;
    const licensedBookIds = priorIds === undefined ?
      undefined :
      priorIds.filter((id) =>
        bookLicenses.some((license) => license["bookId"] === id) ||
        !removedIds.includes(id));
    transaction.update(ref, {
      bookLicenses,
      ...(licensedBookIds !== undefined ? {licensedBookIds} : {}),
      updatedAt: Date.now(),
    });
  });
  return Array.from(new Set(removedIds));
}

/**
 * Refunds a store purchase via PayPal - the full remaining amount, or an
 * admin-chosen partial `amount` - and records it on the purchase doc:
 * `refunds[]` entry appended, cumulative `refundAmount` updated, and on a
 * FULL refund `refunded: true` plus `fulfillmentStatus: 'closed'` (with a
 * statusHistory entry) so the order leaves the dashboard/fulfillment
 * queues. A PARTIAL refund deliberately changes neither (user decision -
 * goods may still ship). `revokeLicenses` (the refund dialog's checkbox,
 * default true, full refunds only) additionally strips the digital-book
 * licenses this exact purchase granted. $0 coupon orders skip PayPal and
 * can only be marked fully refunded. Idempotency: a fully-refunded
 * purchase is rejected, and each PayPal call carries a per-attempt-slot
 * key (`refund-<id>-<n>`) so a network retry replays rather than
 * double-refunds, while a genuine second partial gets a fresh key.
 */
export const refundStorePurchase = onCall(
  {
    secrets: [paypalSandboxSecret, paypalLiveSecret, webPaypalSecret],
    timeoutSeconds: 120,
  },
  async (request):
  Promise<RefundStorePurchaseResult> => {
    await requireAdminRole(request.auth?.uid);

    const {purchaseId, revokeLicenses, amount} =
      (request.data ?? {}) as Partial<RefundStorePurchaseRequest>;
    if (!purchaseId) {
      throw new HttpsError("invalid-argument", "purchaseId is required.");
    }
    if (amount != null && (typeof amount !== "number" || !isFinite(amount))) {
      throw new HttpsError("invalid-argument", "amount must be a number.");
    }

    const db = admin.firestore();
    const purchaseRef = db.collection("purchases").doc(purchaseId);
    const purchaseSnap = await purchaseRef.get();
    if (!purchaseSnap.exists) {
      throw new HttpsError("not-found", "Purchase not found.");
    }
    const purchase = purchaseSnap.data() as PurchaseDoc;

    const receipt = (purchase.receipt ?? "").trim();
    const total = typeof purchase.total === "number" ? purchase.total : 0;
    const needsPaypalRefund =
      total > 0 && receipt !== "" &&
      receipt !== "COUPON" && receipt !== "FREE ONLY";

    const plan = computeRefundPlan(purchase, amount, needsPaypalRefund);

    let refundId: string | undefined;
    let refundStatus: string | undefined;
    if (needsPaypalRefund) {
      // Reader-store purchases stamp paypalEnvironment; web-storefront
      // purchases don't and follow the project-based default the web
      // checkout itself uses (sandbox everywhere except production).
      const isReaderPurchase =
        typeof purchase.paypalEnvironment === "string";
      const env: PaypalEnvironment = isReaderPurchase ?
        (purchase.paypalEnvironment as PaypalEnvironment) :
        (process.env.GCLOUD_PROJECT === "impactdisciples-a82a8" ?
          "live" : "sandbox");

      let accessToken: string;
      if (isReaderPurchase) {
        const secret = env === "live" ?
          paypalLiveSecret.value() :
          paypalSandboxSecret.value();
        accessToken = await getAccessToken(env, secret);
      } else {
        const configSnap = await db.collection("config").limit(1).get();
        const clientId = configSnap.docs[0]?.data()?.paypalClientId;
        if (!clientId) {
          throw new HttpsError(
            "failed-precondition", "config.paypalClientId is not set."
          );
        }
        accessToken = await getTokenWithCreds(
          env, clientId, webPaypalSecret.value()
        );
      }

      try {
        const captureId = await getCaptureId(env, accessToken, receipt);
        // Partial refunds pass an explicit dollar amount; a full refund of
        // the ENTIRE charge omits it (PayPal refunds the capture in full).
        // A full refund of a REMAINDER (after earlier partials) must still
        // pass the amount - the capture's full value is no longer
        // refundable.
        const priorRefunds = (purchase.refunds ?? []).length;
        const refundAmountParam =
          plan.isFullRefund && priorRefunds === 0 ?
            undefined :
            plan.requestedCents / 100;
        const refund = await refundCapture(
          env, accessToken, captureId, refundAmountParam,
          `refund-${purchaseId}-${priorRefunds}`
        );
        refundId = refund.id;
        refundStatus = refund.status;
      } catch (err) {
        throw new HttpsError(
          "internal",
          err instanceof Error ? err.message : "PayPal refund failed."
        );
      }
    }

    // Licenses are only stripped on a FULL refund - a partial refund that
    // keeps the product shouldn't take access away (the dialog only offers
    // the checkbox for full refunds).
    const shouldRevoke = plan.isFullRefund && revokeLicenses !== false;
    let revokedBookIds: string[] = [];
    const email = (purchase.email ?? "").trim().toLowerCase();
    if (shouldRevoke && email) {
      revokedBookIds = await stripStorePurchaseLicenses(email, purchaseId);
    }

    const by = request.auth?.token.email ?? request.auth?.uid ?? "";
    const now = Timestamp.now();
    const entry: RefundEntryDoc = {
      amount: plan.requestedCents / 100,
      date: now,
      ...(by ? {by} : {}),
      ...(refundId ? {refundId, refundStatus} : {}),
      ...(revokedBookIds.length ? {licensesRevoked: revokedBookIds} : {}),
    };
    const priorCents = Math.round((purchase.refundAmount ?? 0) * 100);
    const newRefundAmount = (priorCents + plan.requestedCents) / 100;

    const update: Record<string, unknown> = {
      // The cumulative figure the Purchases grid's "Refunded" column and the
      // customer record's lifetime-spend math read (they always read this
      // field; before refunds[] existed nothing ever wrote it).
      refundAmount: newRefundAmount,
      refunds: [...(purchase.refunds ?? []), entry],
      ...(refundId ? {refundId, refundStatus} : {}),
    };

    let fulfillmentClosed = false;
    if (plan.isFullRefund) {
      update.refunded = true;
      update.refundedAt = now;
      update.refundedBy = by;
      update.licensesRevoked = revokedBookIds;
      if (purchase.fulfillmentStatus !== "closed") {
        // Server-side twin of PurchasesService.withStatusHistory() - same
        // entry shape, `by` conditionally spread (never undefined).
        fulfillmentClosed = true;
        update.fulfillmentStatus = "closed";
        update.statusHistory = [
          ...(purchase.statusHistory ?? []),
          {status: "closed", date: now, ...(by ? {by} : {})},
        ];
      }
    }

    await purchaseRef.update(update);

    return {
      refunded: true,
      fullyRefunded: plan.isFullRefund,
      refundAmount: newRefundAmount,
      fulfillmentClosed,
      paypalRefunded: needsPaypalRefund,
      refundId: refundId ?? null,
      revokedBookIds,
    };
  }
);

/**
 * Manual sibling of revokeAdminGrantedLicense for store-purchased
 * licenses: strips `source: 'store-purchase'` entries for one book from
 * one library user, without refunding anything. Used by the Library Users
 * detail screen's license list.
 */
export const revokeStorePurchasedLicense = onCall(async (request):
  Promise<RevokeStorePurchasedLicenseResult> => {
  await requireAdminRole(request.auth?.uid);

  const {email, bookId, storePurchaseId} =
    (request.data ?? {}) as Partial<RevokeStorePurchasedLicenseRequest>;
  if (!email || !bookId) {
    throw new HttpsError("invalid-argument", "email and bookId are required.");
  }
  const normalized = email.trim().toLowerCase();
  const removed = await stripStorePurchaseLicenses(
    normalized, storePurchaseId, bookId
  );
  return {removed: removed.length > 0};
});
