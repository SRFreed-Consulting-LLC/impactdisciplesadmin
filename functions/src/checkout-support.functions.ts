import {triggerPath} from "./common/shared/lists/tenancy";
import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import {restrictedCors} from "./utils/security.functions";
import {getFirestore} from "firebase-admin/firestore";
import {isCouponExpired} from "./utils/coupons";
import {toMillis} from "./utils/date-normalize.functions";
import {
  LookupCouponResult,
} from "./common/shared/contract/library-callables.types";

/**
 * Pre-prod checklist items #4 and #5: retire two anonymous client
 * Firestore access patterns the storefront/reader depended on.
 *
 * #5 - coupon lookup: the clients used to read the `coupons` collection
 * directly (the web by exact code, the reader case-insensitively), which
 * required a world-readable collection - i.e. anyone could enumerate
 * every discount code. Both now resolve ONE code through here
 * (case-insensitive, superset of both old behaviors), and the rules
 * lock `coupons` to staff. Two faces over one core, matching each
 * app's convention: `lookup_coupon` (onRequest + restrictedCors) for
 * the web's fetch()-style calls, `lookupCoupon` (onCall) for the
 * reader. Deliberately auth-free: the web has no Firebase Auth at all,
 * and a single-code lookup discloses nothing enumerable. The checkout
 * pricing/grant functions still re-validate server-side regardless -
 * this is UX-layer resolution, not the enforcement point.
 *
 * #4 - tax summaries: checkout-success used to do an anonymous
 * read-modify-write of `tax_rate_summaries` running totals (trivially
 * forgeable, and double-countable on refresh). Replaced by
 * onPurchaseTaxSummary below - a purchases trigger that derives the
 * summary from the purchase doc itself, with an idempotency stamp so
 * at-least-once delivery can't double-count. The collection is now
 * fully closed to clients.
 */
const db = getFirestore();

interface CouponPublicFields {
  id: string;
  code: string;
  isActive: boolean;
  percentOff: number | null;
  tags: {id: string}[];
}

/**
 * Resolves one coupon code, case-insensitively (stored codes aren't
 * consistently cased, so there's no canonical form to query by - the
 * whole small collection is scanned server-side, exactly what the
 * reader's client used to do).
 * @param {string} rawCode The user-entered code.
 * @return {Promise<CouponPublicFields | null>} Public fields, or null.
 */
async function findCouponByCode(
  rawCode: string
): Promise<CouponPublicFields | null> {
  const code = rawCode.trim().toLowerCase();
  if (!code) {
    return null;
  }
  const snap = await db.collection("coupons").get();
  const match = snap.docs.find(
    (d) => ((d.data().code as string) ?? "").toLowerCase() === code
  );
  if (!match) {
    return null;
  }
  const data = match.data();
  return {
    id: match.id,
    code: data.code ?? "",
    // An EXPIRED coupon is reported as inactive rather than as a separate
    // state: every storefront already refuses an inactive coupon, so expiry
    // is honoured by bundles that predate it and cannot be skipped client-side.
    isActive: data.isActive === true && !isCouponExpired(data.expiresAt),
    percentOff: typeof data.percentOff === "number" ? data.percentOff : null,
    tags: Array.isArray(data.tags) ?
      data.tags
        .filter((t) => t && typeof t.id === "string")
        .map((t) => ({id: t.id as string})) :
      [],
  };
}

/** The web storefront's face: POST {code} -> {coupon: ... | null}. */
export const lookupCouponHttp = onRequest((request, response) => {
  return restrictedCors(request, response, async () => {
    if (request.method !== "POST") {
      response.status(405).send({error: "POST required."});
      return;
    }
    const code =
      typeof request.body?.code === "string" ? request.body.code : "";
    response.send({coupon: await findCouponByCode(code)});
  });
});

/** The reader app's face: callable, same result shape. Unlike the web's
 *  onRequest face above (which must stay auth-free - the web has no
 *  Firebase Auth), the reader is always signed in by the time its store
 *  screen exists, so this face requires it - shrinking the anonymous
 *  brute-force surface to just the endpoint that genuinely needs it. */
export const lookupCoupon = onCall(async (request):
  Promise<LookupCouponResult> => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const code =
    typeof (request.data ?? {}).code === "string" ? request.data.code : "";
  return {coupon: await findCouponByCode(code)};
});

/**
 * Rolls a purchase's collected sales tax into the per-year/per-zip
 * `tax_rate_summaries` running totals - the server-side replacement for
 * checkout-success's old anonymous client write. Mirrors that logic's
 * own guard (zip + taxRate + estimatedTaxes all present). The
 * `taxSummaryRecorded` stamp on the purchase doc, checked and written in
 * the SAME transaction as the total, makes a redelivered event a no-op.
 */
export const onPurchaseTaxSummary = onDocumentCreated(
  triggerPath("purchases", "{id}"),
  async (event) => {
    const snap = event.data;
    const data = snap?.data();
    if (!snap || !data) {
      return;
    }
    const zip = data.shippingAddress?.zip as string | undefined;
    const taxes = data.estimatedTaxes as number | undefined;
    if (!zip || !data.taxRate || !taxes) {
      return;
    }
    // toMillis(), not a hand-rolled shape test. purchases.dateProcessed
    // carries five shapes in this database - real Timestamp, Date, ISO
    // string, "MM/dd/yyyy" string, and a malformed plain {seconds,
    // nanoseconds} map (MIGRATION.md: 34 of 391 dev purchases). The ternary
    // this replaces only understood two of them and fell through to
    // Date.now() for the rest, filing that purchase's collected sales tax
    // under the CURRENT year instead of the purchase's own.
    //
    // That write is one-shot - taxSummaryRecorded is stamped in the same
    // transaction below - so a redelivery can never correct it. Tax
    // remittance data; it has to be right the first time.
    //
    // 0 means "nothing parseable", which is the only case where falling back
    // to now is defensible.
    const processedMs = toMillis(data.dateProcessed) || Date.now();
    const year = new Date(processedMs).getFullYear().toString();

    await db.runTransaction(async (transaction) => {
      const fresh = await transaction.get(snap.ref);
      if (!fresh.exists || fresh.data()?.taxSummaryRecorded === true) {
        return;
      }
      const existing = await transaction.get(
        db
          .collection("tax_rate_summaries")
          .where("year", "==", year)
          .where("zip", "==", zip)
          .limit(1)
      );
      if (existing.empty) {
        transaction.create(db.collection("tax_rate_summaries").doc(), {
          year,
          zip,
          total: taxes,
        });
      } else {
        const doc = existing.docs[0];
        transaction.update(doc.ref, {
          total: ((doc.data().total as number) ?? 0) + taxes,
        });
      }
      transaction.update(snap.ref, {taxSummaryRecorded: true});
    });
    logger.info("Recorded tax summary", {purchaseId: event.params.id, zip});
  }
);
