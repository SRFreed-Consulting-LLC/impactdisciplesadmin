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
