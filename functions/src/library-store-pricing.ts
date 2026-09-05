// Single source of truth for the digital-book pricing math that PayPal
// captures are verified against. Extracted so verifyAndGrantReaderStorePurchase
// and purchaseGroupLicenses compute prices identically - a drift between two
// copies would make a legitimate client-computed PayPal charge fail the
// server amount match (or, worse, let a wrong server total pass). Must stay
// in lockstep with the reader's store-pricing.ts effectivePrice; the
// rounding and the sale-versus-coupon rule are the SHARED ones (submodule
// lists/money + lists/coupon-scope) since 2026-09-05, so they cannot drift.
import {round2} from "./common/shared/lists/money";
import {
  couponBeatsSale,
  couponUnitDiscount,
} from "./common/shared/lists/coupon-scope";
import {CouponDoc, couponAppliesToProduct} from "./utils/coupons";

export {round2, couponBeatsSale};

export interface ProductDoc {
  title?: string;
  cost?: number;
  salePrice?: number;
  isActive?: boolean;
  isDigitalBook?: boolean;
  digitalBookId?: string;
  imageUrl?: {url: string; name?: string};
}

/**
 * Whether the buyer is being charged a sale price: a positive salePrice
 * strictly below cost, exactly effectivePrice's own test.
 * @param {ProductDoc} product The product doc's data.
 * @return {boolean} True when the sale price applies.
 */
export function isOnSale(product: ProductDoc): boolean {
  const cost = product.cost ?? 0;
  const sale = product.salePrice;
  return !!sale && sale > 0 && sale < cost;
}

/**
 * The price a buyer actually pays before coupons/tier discounts: salePrice
 * only counts when it's a positive number strictly below cost.
 * @param {ProductDoc} product The product doc's data.
 * @return {number} Effective unit price.
 */
export function effectivePrice(product: ProductDoc): number {
  return isOnSale(product) ?
    (product.salePrice as number) :
    (product.cost ?? 0);
}

/**
 * The per-unit coupon discount on a reader Store line: 0 when the coupon
 * does not cover the product, and 0 when the product is on sale and the
 * coupon is not a giveaway - the shared rule the web cart and the store
 * checkout already applied. Until 2026-09-05 verifyAndGrantReaderStorePurchase
 * stacked the coupon on the sale price, mirroring the reader, which was
 * wrong in the same way.
 * @param {string} productId The product's document id.
 * @param {ProductDoc} product The product doc's data.
 * @param {CouponDoc|undefined} coupon The resolved coupon, if any.
 * @return {number} The discount off effectivePrice, to the cent.
 */
export function readerLineDiscount(
  productId: string,
  product: ProductDoc,
  coupon: CouponDoc | undefined
): number {
  if (!coupon || !couponAppliesToProduct(coupon, productId)) {
    return 0;
  }
  return couponUnitDiscount(
    coupon.percentOff, effectivePrice(product), isOnSale(product)
  );
}

/** What a bulk group-license purchase costs, all figures rounded to cents. */
export interface GroupLicensePricing {
  subtotal: number;
  discount: number;
  total: number;
  /** Per-license price after the tier discount - stored on each license so
   *  a later refund knows what one seat was actually worth. */
  unitDiscountPrice: number;
}

/**
 * Server-authoritative pricing for purchaseGroupLicenses, extracted so the
 * arithmetic can be unit-tested without an emulator (the amount computed
 * here is what a PayPal capture is verified against - if it drifts, either
 * a legitimate payment is rejected or an underpayment is accepted).
 * @param {number} unitPrice Effective per-license price (see effectivePrice).
 * @param {number} quantity How many licenses are being bought.
 * @param {number} percentOff Resolved bulk-discount tier percentage, 0-100.
 * @return {GroupLicensePricing} Subtotal, discount, total and unit price.
 */
export function computeGroupLicensePricing(
  unitPrice: number,
  quantity: number,
  percentOff: number
): GroupLicensePricing {
  const subtotal = round2(unitPrice * quantity);
  const discount = round2((subtotal * percentOff) / 100);
  const total = round2(subtotal - discount);
  return {
    subtotal,
    discount,
    total,
    unitDiscountPrice: quantity ? round2(total / quantity) : 0,
  };
}
