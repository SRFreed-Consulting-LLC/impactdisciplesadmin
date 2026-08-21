// Single source of truth for the digital-book pricing math that PayPal
// captures are verified against. Extracted so verifyAndGrantReaderStorePurchase
// and purchaseGroupLicenses compute prices identically - a drift between two
// copies would make a legitimate client-computed PayPal charge fail the
// server amount match (or, worse, let a wrong server total pass). Must stay
// in lockstep with the reader's store-pricing.ts round2/effectivePrice.

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
 * Cent-rounding, identical to the reader's store-pricing.ts round2.
 * @param {number} value Raw amount.
 * @return {number} Rounded to 2 decimal places.
 */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The price a buyer actually pays before coupons/tier discounts: salePrice
 * only counts when it's a positive number strictly below cost.
 * @param {ProductDoc} product The product doc's data.
 * @return {number} Effective unit price.
 */
export function effectivePrice(product: ProductDoc): number {
  const cost = product.cost ?? 0;
  const sale = product.salePrice;
  return sale && sale > 0 && sale < cost ? sale : cost;
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
