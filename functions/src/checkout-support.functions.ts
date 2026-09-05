import {tenantPath, triggerPath} from "./common/shared/lists/tenancy";
const TAX_SUMMARIES = tenantPath("tax_rate_summaries");
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import {publicHttp} from "./utils/public-http";
import {RateLimiter, clientIp} from "./utils/rate-limit";
import {getFirestore} from "firebase-admin/firestore";
import {findActiveCoupon} from "./utils/coupons";
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
 * Resolves one coupon code through the shared findActiveCoupon (utils/
 * coupons.ts) - case-insensitive, isActive checked BEFORE picking, expiry
 * honoured - so this endpoint and the checkout that follows it agree. Its
 * own find here used to skip the isActive filter, so a duplicated code
 * (prod has two SAVE coupons) could report the inactive twin and refuse a
 * code checkout would then accept.
 *
 * An expired or inactive coupon simply resolves to null: every storefront
 * already refuses a null/inactive coupon, so nothing client-side changes.
 * @param {string} rawCode The user-entered code.
 * @return {Promise<CouponPublicFields | null>} Public fields, or null.
 */
async function findCouponByCode(
  rawCode: string
): Promise<CouponPublicFields | null> {
  const found = await findActiveCoupon(db, rawCode);
  if (!found) {
    return null;
  }
  const data = found.data;
  return {
    id: found.id,
    code: data.code ?? "",
    isActive: true,
    percentOff: typeof data.percentOff === "number" ? data.percentOff : null,
    tags: Array.isArray(data.tags) ?
      data.tags
        .filter((t) => t && typeof t.id === "string")
        .map((t) => ({id: t.id as string})) :
      [],
  };
}

// The brake on the coupon-code oracle (review finding, 2026-09-05). This
// endpoint is auth-free by necessity and answers "is X a code" for any X,
// so an unthrottled caller could walk a dictionary through it. Thirty
// tries a minute per address is generous for a shopper mistyping and
// useless for a scan; maxInstances keeps the fleet from scaling around
// the per-instance counter.
const LOOKUP_LIMIT = new RateLimiter(30, 60_000);

/** The web storefront's face: POST {code} -> {coupon: ... | null}. */
export const lookupCouponHttp = publicHttp(
  "lookup_coupon", {method: "POST", maxInstances: 2},
  async (request, response) => {
    if (!LOOKUP_LIMIT.allow(clientIp(request))) {
      response.status(429).send({error: "Too many attempts. Try again in " +
        "a minute."});
      return;
    }
    const code =
      typeof request.body?.code === "string" ? request.body.code : "";
    response.send({coupon: await findCouponByCode(code)});
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
          .collection(TAX_SUMMARIES)
          .where("year", "==", year)
          .where("zip", "==", zip)
          .limit(1)
      );
      if (existing.empty) {
        transaction.create(db.collection(TAX_SUMMARIES).doc(), {
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
