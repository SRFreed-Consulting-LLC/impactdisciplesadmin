import { Timestamp } from "firebase/firestore";
import { Role } from "@impact-common/shared/lists/roles.enum";
import { Person } from "@impact-common/shared/models/domain/utils/person.model";
import { ContactNoteModel } from "./contact-note.model";

// A customer record is now created/kept up to date automatically from two
// sources - the storefront's checkout (functions/src/customer-upsert.
// functions.ts's onPurchaseCustomerUpsert) and event registrations
// (functions/src/event-registration-customer-upsert.functions.ts's
// onEventRegistrationCustomerUpsert) - rather than by an admin typing one
// in. There's no manual "New Customer" flow left in the app any more (see
// contacts.component.ts's own comment). ONE sanctioned admin-side
// exception (2026-08, user-approved): promoting an organization's Point of
// Contact / a form-submission requester into a contact via the
// create-org-contact flow - always admin-reviewed, deduped by email
// (links instead of duplicating), and it never overwrites existing
// profile fields. A purchase's email/name/phone/
// address (when the order has a physical item) or an event registration's
// email/name gets matched against this collection by email and either
// creates a brand-new record or, for an existing one, either updates it
// directly or - for anything that actually differs from what's already on
// file - queues a PendingContactChange instead of silently overwriting
// real customer data from an unverified source.
export interface PendingContactChange {
    field: 'firstName' | 'lastName' | 'phone' | 'shippingAddress' | 'billingAddress';
    currentValue: unknown;
    proposedValue: unknown;
    // Which trigger surfaced this, and the id of that specific purchase/
    // registration doc - not acted on anywhere yet (no "jump to that
    // order/registration" affordance exists), but kept so adding one later
    // doesn't need a data migration.
    source: 'purchase' | 'eventRegistration';
    sourceId: string;
    detectedDate: Timestamp;
}

export class ContactModel extends Person {
    email: string;
    firebaseUID: string;
    role: Role = Role.CUSTOMER;
    notes?: ContactNoteModel[] = [];

    // Un-actioned discrepancies between this record and a more recent
    // purchase or event registration under the same email - surfaced on
    // the Customers screen (a count) and resolved one at a time in
    // ContactDetailsComponent's Pending Updates strip (accept applies
    // proposedValue, reject just drops the entry and keeps currentValue).
    // Same `field` never appears twice - a second purchase/registration
    // before the first is resolved replaces the earlier entry for that
    // field rather than piling up duplicates.
    pendingChanges?: PendingContactChange[] = [];

    // Replaces the old standalone `subscriptions` collection/Subscribers
    // screen entirely - a subscriber IS a customer now, not a separate
    // record. Just booleans + when-it-happened, no more per-type doc: set
    // true (and the matching date stamped) the moment someone
    // subscribes, flipped false on unsubscribe (the date is left alone -
    // it's "last subscribed", not "currently subscribed since", so it's
    // still meaningful history after an unsubscribe/re-subscribe). See
    // functions/src/subscriptions.functions.ts for both directions of that
    // write.
    subscribedToNewsletter?: boolean;
    newsletterSubscribedDate?: Timestamp;
    subscribedToPrayerTeam?: boolean;
    prayerTeamSubscribedDate?: Timestamp;

    // Customer tags, applied automatically by tag rules (see
    // TagRuleModel / functions/src/tag-rules.functions.ts) and manually on
    // Customer Details. A plain string[] so campaigns can target it with
    // an arrayContains query; WHEN/WHY each tag landed (the auto-campaign
    // scheduler's anchor date) lives in the tag_applications collection,
    // one doc per (email, tag).
    tags?: string[];

    // The organization this person belongs to (organizations/{id}) - "the
    // people inside these organizations". One org per contact, no role/
    // title (user decision, 2026-08). Written via conditional spread only
    // (never a literal undefined - see the Firestore write gotcha in
    // CLAUDE.md); set from Contact Details' Organization select, the org
    // screen's member linking, or a PoC promotion.
    organizationId?: string;

    // Mirrors CheckoutForm's own isShippingSameAsBilling (cart.model.ts),
    // direction flipped to match how Customer Details presents the 2
    // sections (Shipping first, Billing collapses into it) - when true,
    // billingAddress is kept as a copy of shippingAddress (re-copied on
    // every Save, not just live-mirrored while editing) rather than being
    // independently maintained, and the Billing Address section on
    // Customer Details hides entirely while this is checked.
    isBillingSameAsShipping?: boolean;

    constructor(){
      super();
    }


}

// The old SubscriptionModel's `type` discriminator, kept as a standalone
// type export (rather than reintroducing that model) now that it just picks
// between 2 fields on ContactModel instead of 2 collections.
export type SubscriptionType = 'newsletter' | 'prayer';

// Same flagField/dateField mapping as functions/src/subscriptions.
// functions.ts's own fieldsForType() - duplicated rather than imported since
// the Angular app and Cloud Functions are separate TS projects with no
// shared package between them. Keep the two in sync by hand if this ever
// changes. Used everywhere the admin app itself needs to flip one of these
// flags (Subscribers screen's add/edit/delete, Subscriber Report) so the
// field-name pairing only lives in one place per project.
export function subscriptionFieldsForType(
  type: SubscriptionType
): { flagField: 'subscribedToNewsletter' | 'subscribedToPrayerTeam'; dateField: 'newsletterSubscribedDate' | 'prayerTeamSubscribedDate' } {
  return type === 'prayer'
    ? { flagField: 'subscribedToPrayerTeam', dateField: 'prayerTeamSubscribedDate' }
    : { flagField: 'subscribedToNewsletter', dateField: 'newsletterSubscribedDate' };
}
