import {onDocumentCreated} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import {hasPhysicalItem} from "./utils/cart-items.functions";

// Backs the Store Manager > Fulfillment screen's 5-step physical-order
// workflow (new -> received -> shipping_label_printed -> awaiting_shipping
// -> closed - see src/app/common/models/utils/cart.model.ts's
// FulfillmentStatus and src/app/store-manager/fulfillment/fulfillment-steps.ts
// for the full step list). Tagging a new purchase with its starting
// fulfillmentStatus has to happen server-side, in a trigger, for the exact
// same reason new-record-alerts.functions.ts's own purchases trigger does:
// purchases are written by the public storefront, a separate repo this
// function set has no reach into. This is one of several independent
// onCreate triggers on the same "purchases" collection (see also
// new-record-alerts.functions.ts and customer-upsert.functions.ts) -
// Firestore dispatches a creation event to every registered trigger on a
// path, so these don't conflict with each other.
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

export const onPurchaseFulfillmentEligible = onDocumentCreated(
  "purchases/{id}",
  async (event) => {
    const snap = event.data;
    const data = snap?.data();

    if (!snap || !data || data.fulfillmentStatus) {
      return;
    }

    const isPhysical = hasPhysicalItem(data.cartItems);
    const status = isPhysical ? "new" : "closed";
    await snap.ref.update({
      fulfillmentStatus: status,
      // First entry of the Sale Details tab's timeline - see
      // StatusHistoryEntry's own comment (cart.model.ts) for why this has to
      // land in the same write as fulfillmentStatus itself.
      statusHistory: [{status, date: admin.firestore.Timestamp.now()}],
    });
  }
);
