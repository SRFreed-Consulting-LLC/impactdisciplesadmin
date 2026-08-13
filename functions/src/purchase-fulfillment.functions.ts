import {onDocumentCreated} from "firebase-functions/v2/firestore";

// Backs the Store Manager > Fulfillment screen's 5-step physical-order
// workflow (new -> received -> shipping_label_printed -> awaiting_shipping
// -> closed - see src/app/common/models/utils/cart.model.ts's
// FulfillmentStatus and src/app/store-manager/fulfillment/fulfillment-steps.ts
// for the full step list). Tagging a new purchase with its starting
// fulfillmentStatus has to happen server-side, in a trigger, for the exact
// same reason new-record-alerts.functions.ts's own purchases trigger does:
// purchases are written by the public storefront, a separate repo this
// function set has no reach into. This is a second, independent onCreate
// trigger on the same "purchases" collection - Firestore dispatches a
// creation event to every registered trigger on a path, so this doesn't
// conflict with that other one.
//
// Every purchase gets a fulfillmentStatus now, not just physical-item ones
// - it's the only order-status field left on a purchase doc (the old
// separate processedStatus field, NEW/COMPLETE/REFUNDED, was removed
// entirely in favor of this one). A purchase with no physical item (pure
// ebook/digital book/event registration) has nothing to ship, so it's
// stamped "closed" immediately - already done, nothing for the Fulfillment
// screen to do with it (matches that screen's own `fulfillmentStatus !==
// 'closed'` filter, so these correctly never show up there).
//
// Every step past "new"/"closed"-at-creation (received/
// shipping_label_printed/awaiting_shipping/closed-via-workflow) is set
// directly by the admin app itself (PurchasesService), not by any Cloud
// Function - they're admin-triggered actions, not events the storefront
// produces. 'received' -> 'closed' is also a valid direct jump - the
// pickup/hand-delivery override.

interface CartItemFlags {
  isEBook?: boolean;
  isDigitalBook?: boolean;
  isEvent?: boolean;
}

/**
 * A purchase enters the *active* Fulfillment workflow (starts at "new"
 * rather than immediately "closed") only if it has at least one line item
 * that actually needs to be packaged and shipped - not an ebook, not a
 * digital book, and not an event registration bought through the same
 * cart.
 * @param {CartItemFlags[] | undefined} cartItems The purchase's own
 * cartItems array.
 * @return {boolean} Whether this purchase has a physical item.
 */
function hasPhysicalItem(cartItems: CartItemFlags[] | undefined): boolean {
  if (!Array.isArray(cartItems)) {
    return false;
  }
  return cartItems.some(
    (item) => !item.isEBook && !item.isDigitalBook && !item.isEvent
  );
}

export const onPurchaseFulfillmentEligible = onDocumentCreated(
  "purchases/{id}",
  async (event) => {
    const snap = event.data;
    const data = snap?.data();

    if (!snap || !data || data.fulfillmentStatus) {
      return;
    }

    const isPhysical = hasPhysicalItem(data.cartItems);
    await snap.ref.update({fulfillmentStatus: isPhysical ? "new" : "closed"});
  }
);
