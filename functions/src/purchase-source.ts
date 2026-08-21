/**
 * Which storefront wrote a `purchases` document.
 *
 * The web storefront and the reader store both write into the SAME
 * `purchases` collection in the SAME database, with genuinely different
 * document shapes. Until 2026-08-21 nothing recorded which was which, and
 * the refund path inferred it from whether the doc happened to carry a
 * `paypalEnvironment` field.
 *
 * That inference is correct for every document that can actually reach it
 * today (see purchaseSourceOf), but it is a property of the data rather
 * than a statement of intent: a web purchase that ever gained a
 * `paypalEnvironment` field would start being refunded against the READER
 * PayPal app, which is a different app with different credentials. Since
 * this decides where money is sent back from, it is now recorded
 * explicitly.
 */
export type PurchaseSource = "web" | "reader";

/** Named so a write site can't quietly typo the literal. */
export const PURCHASE_SOURCE_WEB: PurchaseSource = "web";
export const PURCHASE_SOURCE_READER: PurchaseSource = "reader";

/** The subset of a purchase doc this module needs to classify it. */
export interface PurchaseSourceFields {
  source?: unknown;
  paypalEnvironment?: unknown;
}

/**
 * Classifies a purchase document, preferring the explicit `source` stamp
 * and falling back to the legacy inference for documents written before
 * 2026-08-21.
 *
 * The fallback is deliberate and must NOT be removed until every historic
 * document has been backfilled (scripts/backfill-purchase-source.js).
 * Dropping it early would classify every pre-existing reader purchase as
 * `web` and refund it against the wrong PayPal app - strictly worse than
 * the inference it replaced.
 *
 * Legacy rule, preserved exactly: reader-store purchases stamp
 * `paypalEnvironment` when they go through PayPal; web-storefront
 * purchases never write that field at all.
 * @param {PurchaseSourceFields} purchase The purchase document.
 * @return {PurchaseSource} Which storefront wrote it.
 */
export function purchaseSourceOf(
  purchase: PurchaseSourceFields
): PurchaseSource {
  if (purchase.source === "web" || purchase.source === "reader") {
    return purchase.source;
  }
  return typeof purchase.paypalEnvironment === "string" ? "reader" : "web";
}
