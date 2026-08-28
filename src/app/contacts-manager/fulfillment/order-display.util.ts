import { CheckoutForm } from '@impact-common/shared/models/utils/cart.model';

// How an order is LABELLED, wherever it is shown. Sibling of
// fulfillment-steps.ts, which owns how an order's progress is DRAWN.
//
// These three existed as four, three and two private copies respectively
// (2026-08-27 sweep, P9) across Fulfillment, the Dashboard's Recent Orders
// preview, the order-workflow dialog and Purchase Details - four surfaces
// that display the SAME order. fulfillment.component.ts already carries the
// reasoning for why that is not acceptable, about the helper next door:
//
//   "Delegates to the shared free function (fulfillment-steps.ts) so this
//    and DashboardComponent's read-only Recent Orders preview render
//    identical bars off one definition"
//
// The same argument applies to the words. These escaped that extraction, so
// the same order could be titled differently in two panes if one copy were
// changed - and the fallback literals ('Unknown', '—') had no owner at all.

/**
 * The buyer's display name: full name, falling back to their email, falling
 * back to 'Unknown'.
 *
 * A guest checkout can genuinely have no name, so the email fallback is the
 * common case rather than an edge one.
 * @param {CheckoutForm} item The order.
 * @return {string} Never empty.
 */
export function customerName(item: CheckoutForm): string {
  return [item.firstName, item.lastName].filter(Boolean).join(' ') ||
    item.email ||
    'Unknown';
}

/**
 * A one-line summary of what was ordered - the cart item names, comma
 * separated, or an em dash when there is nothing nameable.
 * @param {CheckoutForm} item The order.
 * @return {string} Never empty.
 */
export function itemSummary(item: CheckoutForm): string {
  return (item.cartItems ?? [])
    .map((c) => c.itemName)
    .filter(Boolean)
    .join(', ') || '—';
}

/**
 * Whether the order is still unacknowledged.
 *
 * Distinct from `newRecordStatus`, which drives the alert bell - this is the
 * FULFILLMENT status, i.e. whether staff have started working the order.
 * @param {CheckoutForm} item The order.
 * @return {boolean} True while the order is still 'new'.
 */
export function isNewOrder(item: CheckoutForm): boolean {
  return item.fulfillmentStatus === 'new';
}
