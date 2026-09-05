// Coupon resolution rules, shared by every path that turns a
// shopper-entered code into a discount.
//
// Extracted 2026-08-27 when the store checkout path was found resolving
// codes differently from the other three (library-purchases,
// library-group-licenses, checkout-support's lookup_coupon) - and getting
// it wrong. See pickActiveCoupon for the three specific defects.
import {DocumentData, Firestore} from "firebase-admin/firestore";
import {toMillis} from "./date-normalize.functions";
import {tenantPath} from "../common/shared/lists/tenancy";
import {CouponDocument} from "../common/shared/contract/library-store.types";

const COUPONS = tenantPath("coupons");
import {
  couponOverridesSale,
  couponTagsCover,
} from "../common/shared/lists/coupon-scope";

// The tag-scope and sale-override rules live in the shared submodule so the
// web cart's coupon box and this server agree by construction. Re-exported
// so the pricing paths keep one import for everything coupon.
export {couponOverridesSale, couponTagsCover};

/**
 * Whether a coupon expiry has passed. Absent means it never expires, which
 * every coupon written before Campaign Manager v3 was.
 *
 * Date parsing goes through toMillis deliberately rather than being
 * inlined: it is the one place that also handles the malformed
 * {seconds, nanoseconds} PLAIN MAP shape, which really does occur in this
 * database (a serialized Timestamp written back without being rehydrated -
 * ~28% of purchase line items carry dates that way). A hand-rolled
 * `new Date(value)` returns NaN for that shape and would silently read as
 * "never expires".
 * @param {unknown} expiresAt The stored expiry.
 * @return {boolean} True when it has passed.
 */
export function isCouponExpired(expiresAt: unknown): boolean {
  if (expiresAt === null || expiresAt === undefined) {
    return false;
  }
  const ms = toMillis(expiresAt);
  return ms > 0 && ms < Date.now();
}

/**
 * Picks the one ACTIVE, unexpired coupon matching a shopper-entered code.
 *
 * Three things this does that the store checkout's previous
 * `where("code", "==", code).limit(1)` query could not, each of which was
 * a live defect:
 *
 *  - MATCHES CASE-INSENSITIVELY. Stored codes are not consistently cased,
 *    so there is no canonical form to query by. The lookup_coupon endpoint
 *    that tells the shopper "applied" already matched case-insensitively,
 *    so a lowercase-entered code showed a discount in the cart and then
 *    found nothing at checkout - the shopper was charged full price.
 *  - FILTERS ON isActive BEFORE picking, not after. `limit(1)` returns an
 *    arbitrary document, so where a code is duplicated (prod has two
 *    SAVE coupons) an INACTIVE twin could suppress the live one entirely.
 *  - HONOURS EXPIRY, which the store path never did.
 *
 * Takes plain document data rather than a QuerySnapshot so it stays pure
 * and directly testable.
 * @param {DocumentData[]} coupons Every coupon document's data.
 * @param {string} rawCode The shopper-entered code.
 * @return {DocumentData|undefined} The matching coupon, if any.
 */
export function pickActiveCoupon(
  coupons: DocumentData[],
  rawCode: string | null | undefined
): DocumentData | undefined {
  const code = (rawCode ?? "").trim().toLowerCase();
  if (!code) {
    return undefined;
  }
  return coupons.find(
    (c) =>
      c.isActive === true &&
      !isCouponExpired(c.expiresAt) &&
      String(c.code ?? "").trim().toLowerCase() === code
  );
}

/** A matched coupon: its document id and its data. */
export interface FoundCoupon {
  id: string;
  data: DocumentData;
}

/**
 * The read and the pick, together: every ACTIVE, unexpired coupon matching
 * a shopper-entered code, by document id. The whole (small) collection is
 * scanned rather than queried by code equality - see pickActiveCoupon for
 * why a `where("code", "==")` cannot do this job.
 *
 * Four paths did this read themselves until 2026-09-05, and one of them
 * (lookup_coupon, the endpoint that tells the shopper "applied") did its
 * own find with NO isActive filter, so a duplicated code could report the
 * inactive twin and refuse a code checkout would then accept.
 * @param {Firestore} db Firestore.
 * @param {string|null|undefined} rawCode The shopper-entered code.
 * @return {Promise<FoundCoupon|undefined>} The matching coupon, if any.
 */
export async function findActiveCoupon(
  db: Firestore,
  rawCode: string | null | undefined
): Promise<FoundCoupon | undefined> {
  if (!(rawCode ?? "").trim()) {
    return undefined;
  }
  const snap = await db.collection(COUPONS).get();
  // data() is read once per document: the pick is matched back to its
  // document by object identity.
  const docs = snap.docs.map((d) => ({id: d.id, data: d.data()}));
  const picked = pickActiveCoupon(docs.map((d) => d.data), rawCode);
  return docs.find((d) => d.data === picked);
}

/**
 * The shape the money paths read a coupon document as.
 *
 * Declared once because it had already DRIFTED between callers
 * (library-group-licenses' copy carried `expiresAt`, library-purchases' did
 * not). Since 2026-09-05 the declaration itself lives in the shared
 * contract (CouponDocument, library-store.types.ts), where the admin suite
 * checks every field against the full CouponModel - so a renamed coupon
 * field fails a build rather than reading undefined on a money path.
 */
export type CouponDoc = CouponDocument;

/**
 * Whether a coupon discounts a given product.
 *
 * A coupon with no tags applies to everything; a tagged one applies only to
 * products whose doc id is in its tag list. The all-events sentinel never
 * matches here - a product is not an event.
 *
 * Tag scoping was the last coupon rule still resolved by two private copies
 * after pickActiveCoupon was extracted (2026-08-27) - which is exactly why it
 * was next to drift the way that extraction existed to stop. The rule itself
 * now lives in the shared submodule (couponTagsCover).
 * @param {CouponDoc} coupon The coupon document's data.
 * @param {string} productId The product's document id.
 * @return {boolean} Whether the coupon discounts this product.
 */
export function couponAppliesToProduct(
  coupon: CouponDoc,
  productId: string
): boolean {
  return couponTagsCover(coupon.tags, {id: productId});
}
