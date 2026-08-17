import {onCall, HttpsError} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import * as admin from "firebase-admin";
import {requireAdminRole} from "./admin-users.functions";
import {
  PaypalEnvironment,
  getAccessToken,
  getCaptureId,
  refundCapture,
} from "./library-paypal";

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

const db = admin.firestore();

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

interface PurchaseDoc {
  email?: string;
  total?: number;
  receipt?: string;
  refunded?: boolean;
  paypalEnvironment?: string;
  cartItems?: Array<{
    isDigitalBook?: boolean;
    digitalBookId?: string;
  }>;
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
 * Refunds a store purchase (full amount) via PayPal and marks the
 * purchase doc refunded. `revokeLicenses` (the refund dialog's checkbox,
 * default true) additionally strips the digital-book licenses this exact
 * purchase granted. $0 coupon orders skip PayPal entirely and just mark +
 * revoke. Idempotent: an already-refunded purchase is rejected, and the
 * PayPal call carries a purchase-derived idempotency key.
 */
export const refundStorePurchase = onCall(
  {
    secrets: [paypalSandboxSecret, paypalLiveSecret, webPaypalSecret],
    timeoutSeconds: 120,
  },
  async (request) => {
    await requireAdminRole(request.auth?.uid);

    const {purchaseId, revokeLicenses} = (request.data ?? {}) as {
      purchaseId?: string;
      revokeLicenses?: boolean;
    };
    if (!purchaseId) {
      throw new HttpsError("invalid-argument", "purchaseId is required.");
    }

    const purchaseRef = db.collection("purchases").doc(purchaseId);
    const purchaseSnap = await purchaseRef.get();
    if (!purchaseSnap.exists) {
      throw new HttpsError("not-found", "Purchase not found.");
    }
    const purchase = purchaseSnap.data() as PurchaseDoc;
    if (purchase.refunded === true) {
      throw new HttpsError(
        "failed-precondition", "This purchase was already refunded."
      );
    }

    const receipt = (purchase.receipt ?? "").trim();
    const total = typeof purchase.total === "number" ? purchase.total : 0;
    const needsPaypalRefund =
      total > 0 && receipt !== "" &&
      receipt !== "COUPON" && receipt !== "FREE ONLY";

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
        const refund = await refundCapture(
          env, accessToken, captureId, undefined, `refund-${purchaseId}`
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

    const shouldRevoke = revokeLicenses !== false;
    let revokedBookIds: string[] = [];
    const email = (purchase.email ?? "").trim().toLowerCase();
    if (shouldRevoke && email) {
      revokedBookIds = await stripStorePurchaseLicenses(email, purchaseId);
    }

    await purchaseRef.update({
      refunded: true,
      refundedAt: admin.firestore.Timestamp.now(),
      refundedBy: request.auth?.token.email ?? request.auth?.uid ?? "",
      ...(refundId ? {refundId, refundStatus} : {}),
      licensesRevoked: revokedBookIds,
    });

    return {
      refunded: true,
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
export const revokeStorePurchasedLicense = onCall(async (request) => {
  await requireAdminRole(request.auth?.uid);

  const {email, bookId, storePurchaseId} = (request.data ?? {}) as {
    email?: string;
    bookId?: string;
    storePurchaseId?: string;
  };
  if (!email || !bookId) {
    throw new HttpsError("invalid-argument", "email and bookId are required.");
  }
  const normalized = email.trim().toLowerCase();
  const removed = await stripStorePurchaseLicenses(
    normalized, storePurchaseId, bookId
  );
  return {removed: removed.length > 0};
});
