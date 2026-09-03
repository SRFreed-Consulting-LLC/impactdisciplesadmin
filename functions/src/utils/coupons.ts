// Coupon resolution rules, shared by every path that turns a
// shopper-entered code into a discount.
//
// Extracted 2026-08-27 when the store checkout path was found resolving
// codes differently from the other three (library-purchases,
// library-group-licenses, checkout-support's lookup_coupon) - and getting
// it wrong. See pickActiveCoupon for the three specific defects.
import {DocumentData} from "firebase-admin/firestore";
import {toMillis} from "./date-normalize.functions";
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

/**
 * The shape the two reader money paths read a coupon document as.
 *
 * Declared here rather than privately in each caller because it had already
 * DRIFTED: library-group-licenses' copy carried `expiresAt`, and
 * library-purchases' did not - so the two disagreed about whether expiry was
 * even part of a coupon, on the paths that decide what a customer is charged.
 */
export interface CouponDoc {
  code?: string;
  isActive?: boolean;
  percentOff?: number | null;
  expiresAt?: unknown;
  tags?: {id: string}[];
}

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
