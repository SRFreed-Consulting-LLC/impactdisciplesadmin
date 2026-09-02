import {tenantPath} from "../common/shared/lists/tenancy";
const PURCHASES = tenantPath("purchases");
import {HttpsError} from "firebase-functions/v2/https";
import {OrderCapture} from "../library-paypal";

// The server-side "did the customer actually pay what WE computed" check,
// shared by the reader's two money paths (library-purchases' store checkout
// and library-group-licenses' bulk purchase).
//
// It lived as a copy in each, and the copies had already DRIFTED - the
// free-order threshold was `total > 0.005` in one and `total > 0` in the
// other, so the two paths disagreed about what counts as free. That is the
// check the 2026-08-12 checkout-security work exists to guarantee, which
// makes two implementations of it exactly the wrong number.
//
// The concrete risk of leaving it split: a hardening change - tightening the
// tolerance, adding a payee check, rejecting PARTIALLY_REFUNDED - lands on
// one path and silently misses the other, with nothing in the type system to
// notice. (2026-08-27 sweep, finding P5.)

/**
 * Half a cent. A real charge is at least $0.01, so anything at or below this
 * is float dust from round2() rather than money.
 *
 * Settled on the LOOSER of the two drifted thresholds on purpose: `total > 0`
 * would reject a $0.000000001 rounding artifact as "requires payment" and
 * fail a genuinely free order.
 */
export const FREE_ORDER_EPSILON = 0.005;

/**
 * Whether a server-computed total is free, i.e. needs no PayPal order.
 * @param {number} total The SERVER-computed total.
 * @return {boolean} True when no payment is required.
 */
export function isEffectivelyFree(total: number): boolean {
  return total <= FREE_ORDER_EPSILON;
}

/**
 * Throws unless the PayPal capture actually paid the server-computed total.
 *
 * Two checks, both load-bearing:
 *  - status must be COMPLETED. A captureId existing is NOT proof money moved.
 *  - currency must be USD and the amount must match within a cent. Compared
 *    with a tolerance rather than for equality because PayPal reports its own
 *    string amount and rounding differs.
 *
 * @param {OrderCapture} capture What PayPal reported for the order.
 * @param {number} total The SERVER-computed total, never the client's claim.
 * @param {string} describeTotal How to name the total in the error the caller
 *   sees, e.g. "the computed total ($12.00)" or "the price for 3 licenses
 *   ($30.00)" - the one thing the two call sites legitimately differ on.
 * @return {void} Returns normally when the payment is verified.
 */
export function assertCaptureMatchesTotal(
  capture: OrderCapture,
  total: number,
  describeTotal: string
): void {
  if (capture.status !== "COMPLETED") {
    throw new HttpsError(
      "failed-precondition",
      `PayPal order is not completed (status: ${capture.status}).`
    );
  }
  if (
    capture.currencyCode !== "USD" ||
    Math.abs(capture.amount - total) > 0.01
  ) {
    throw new HttpsError(
      "failed-precondition",
      `PayPal payment (${capture.currencyCode} ${capture.amount}) ` +
        `does not match ${describeTotal}.`
    );
  }
}

/**
 * Finds a purchase already recorded against this PayPal order, if any.
 *
 * Idempotency (sweep 2026-08-17): PayPal itself captures an order only once,
 * but the purchase/licence writes happen AFTER that and a retried callable
 * replays them. `receipt == payPalOrderId` on a paid order, so a prior
 * success is detectable. Callers return their own shape from it - what
 * "already processed" looks like differs between a store purchase and a
 * licence batch, which is why this returns the document rather than a result.
 *
 * @param {FirebaseFirestore.Firestore} db The reader project's Firestore.
 * @param {string} payPalOrderId The captured order id.
 * @return {Promise<FirebaseFirestore.QueryDocumentSnapshot | null>} The prior
 *   purchase document, or null when this order has not been recorded yet.
 */
export async function findPriorPurchaseByReceipt(
  db: FirebaseFirestore.Firestore,
  payPalOrderId: string
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  const prior = await db.collection(PURCHASES)
    .where("receipt", "==", payPalOrderId).limit(1).get();
  return prior.empty ? null : prior.docs[0];
}
