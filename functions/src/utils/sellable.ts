// Whether a product or an event may be SOLD right now.
//
// This existed only as a public-listing query and one inline check, which left
// a real hole: both public listings filter on isActive, but neither filter is
// a boundary. store.component.ts streams `isActive == true` and
// events.component.ts does the same, yet /event-details/:id and the cart both
// address an item BY ID with no filter at all - so anyone holding a link, a
// bookmark or a stale cart could still check out a delisted product at full
// price, and nothing server-side objected. integration/money.test.js used to
// pin exactly that, and its assertion (a 400 from the emulator's PayPal
// boundary) made it look like something was stopping it. Nothing was.
//
// The two rules are deliberately DIFFERENT, and neither is invented here -
// each mirrors what the rest of the system already does.

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Whether a product may be sold.
 *
 * Strict `=== true`, mirroring the storefront's own
 * `streamAllByValue('isActive', true)` - a Firestore equality, which also
 * excludes documents missing the field entirely. So "absent" is not "active":
 * anything the store will actually show has isActive explicitly true, and this
 * refuses precisely what the store refuses to list.
 * @param {any} doc The product document data.
 * @return {boolean} True when the product may be sold.
 */
export function isProductSellable(doc: any): boolean {
  return doc?.isActive === true;
}

/**
 * Whether an event is open for registration.
 *
 * PERMISSIVE by comparison, and that is on purpose - this is the rule
 * event-registration.functions.ts has always applied, lifted here verbatim so
 * the free registration path and the PAID checkout path cannot drift apart.
 * Two copies of a selling rule is how one of them silently stops matching the
 * other.
 *
 * `isActive !== false` (absent counts as open), OR earlyRegistration: a summit
 * can accept sign-ups BEFORE it goes live publicly - the summit page keeps its
 * coming-soon placeholder and the events list still hides it, and the only way
 * in is the direct /event-details/{id} link an early-bird campaign carries.
 * Applying the product rule to events would have broken exactly the flow the
 * early-bird campaign offer exists to serve.
 * @param {any} doc The event document data.
 * @return {boolean} True when the event accepts registrations.
 */
export function isEventRegistrationOpen(doc: any): boolean {
  return doc?.isActive !== false || doc?.earlyRegistration === true;
}
