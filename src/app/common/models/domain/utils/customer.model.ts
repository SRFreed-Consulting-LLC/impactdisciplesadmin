import { Timestamp } from "firebase/firestore";
import { Role } from "src/app/common/lists/roles.enum";
import { Person } from "./person.model";
import { CustomerNoteModel } from "./customer-note.model";

// A customer record is now created/kept up to date automatically from two
// sources - the storefront's checkout (functions/src/customer-upsert.
// functions.ts's onPurchaseCustomerUpsert) and event registrations
// (functions/src/event-registration-customer-upsert.functions.ts's
// onEventRegistrationCustomerUpsert) - rather than by an admin typing one
// in. There's no manual "New Customer" flow left in the app any more (see
// customers.component.ts's own comment). A purchase's email/name/phone/
// address (when the order has a physical item) or an event registration's
// email/name gets matched against this collection by email and either
// creates a brand-new record or, for an existing one, either updates it
// directly or - for anything that actually differs from what's already on
// file - queues a PendingCustomerChange instead of silently overwriting
// real customer data from an unverified source.
export interface PendingCustomerChange {
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

export class CustomerModel extends Person {
    email: string;
    firebaseUID: string;
    role: Role = Role.CUSTOMER;
    notes?: CustomerNoteModel[] = [];

    // Un-actioned discrepancies between this record and a more recent
    // purchase or event registration under the same email - surfaced on
    // the Customers screen (a count) and resolved one at a time in
    // CustomerDetailsComponent's Pending Updates strip (accept applies
    // proposedValue, reject just drops the entry and keeps currentValue).
    // Same `field` never appears twice - a second purchase/registration
    // before the first is resolved replaces the earlier entry for that
    // field rather than piling up duplicates.
    pendingChanges?: PendingCustomerChange[] = [];

    constructor(){
      super();
    }


}
