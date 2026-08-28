import { Timestamp } from 'firebase/firestore';

/**
 * What a shipping label actually cost the org, against what the customer
 * was charged for shipping at checkout.
 *
 * Written SERVER-SIDE ONLY, by get_shipping_label at the moment the label
 * is bought (functions/src/shipping.functions.ts). The client never
 * computes these numbers - the whole point of sweep finding S3 was to stop
 * trusting the client about shipping - it only reads them back.
 *
 * Why it exists: S3 moved label purchase off the rate id quoted at
 * checkout and onto a fresh buy from the purchase's own address, so the
 * price is whatever that service costs at label time rather than what the
 * shopper was quoted. That is safer, but it means the two numbers can
 * diverge. Recording the divergence per purchase is what makes it possible
 * to say what the change is actually costing (or saving) rather than
 * guessing - owner's request, 2026-08-28.
 *
 * Deliberately declared HERE rather than on CheckoutForm in the shared
 * submodule: `src/common` currently carries an unpushed commit for the
 * reader lockout-alert work that another session still has to push, and
 * adding to it would force a pointer bump on this branch and tangle the
 * two. Move it onto CheckoutForm once that has landed.
 */
export interface ShippingCostDrift {
  /** Shipping charged to the customer at checkout, in dollars. */
  quoted: number;
  /** What the label cost the org, in dollars. */
  actual: number;
  /** actual - quoted. POSITIVE means the org absorbed the difference. */
  drift: number;
  /** When the label was bought. */
  at: Timestamp;
}

/** A purchase as the Purchases screen reads it, including the drift. */
export type WithShippingCostDrift<T> = T & {
  shippingCostDrift?: ShippingCostDrift;
};
