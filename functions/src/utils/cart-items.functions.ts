// Shared by purchase-fulfillment.functions.ts and customer-upsert.functions.ts
// - both need to know whether a purchase has anything that actually needs
// to ship, for two independent reasons (whether the Fulfillment workflow
// applies at all, and whether a shipping/billing address is even meaningful
// to compare against a customer record). One definition so those two
// questions can't quietly drift apart.

export interface CartItemFlags {
  isEBook?: boolean;
  isDigitalBook?: boolean;
  isEvent?: boolean;
}

/**
 * Whether a purchase has at least one line item that actually needs to be
 * packaged and shipped - not an ebook, not a digital book, and not an event
 * registration bought through the same cart.
 * @param {CartItemFlags[] | undefined} cartItems The purchase's own
 * cartItems array.
 * @return {boolean} Whether this purchase has a physical item.
 */
export function hasPhysicalItem(
  cartItems: CartItemFlags[] | undefined
): boolean {
  if (!Array.isArray(cartItems)) {
    return false;
  }
  return cartItems.some(
    (item) => !item.isEBook && !item.isDigitalBook && !item.isEvent
  );
}
