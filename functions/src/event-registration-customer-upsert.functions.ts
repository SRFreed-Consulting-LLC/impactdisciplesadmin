import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {getFirestore} from "firebase-admin/firestore";
import {
  findOrCreateCustomer,
  isPlausibleEmail,
} from "./utils/customer-match.functions";
import {CustomerReconciler} from "./utils/customer-reconcile";
import {
  activityFromRegistration,
  applyTagRulesForActivity,
} from "./tag-rules.functions";

// Event registrations now also create/update a "customers" record, same as
// purchases do (customer-upsert.functions.ts) - see
// src/app/common/models/domain/utils/customer.model.ts's own comment.
// "Registering for an event makes you a customer too, not just buying
// something" - a deliberate 2026-08-13 decision (each event-registrations
// doc is already one person with their own email - verified no
// registration doc bundles multiple attendees the way a purchase's
// cartItems can - so this is a straightforward per-doc upsert, no
// per-attendee fan-out needed).
//
// EventRegistrationModel (src/app/common/models/domain/
// event-registration.model.ts) only ever carries firstName/lastName/email -
// no phone, no address - so this trigger only ever resolves those two name
// fields, unlike the purchase trigger's five. Otherwise identical rules:
//  - nothing on file yet for that field -> filled in directly, not a
//    disagreement.
//  - normalized-matches what's already on file -> left alone.
//  - genuinely differs -> queued as a PendingCustomerChange, same
//    accept/reject flow in CustomerDialogComponent's "Pending Updates" tab.
//
// scripts/backfill-customers-from-event-registrations.js mirrors this
// exact logic (separate plain-JS implementation, same reasoning as
// customer-upsert.functions.ts's own comment on why) to backfill customers
// from registrations that predate this trigger.

export const onEventRegistrationCustomerUpsert = onDocumentCreated(
  "event-registrations/{id}",
  async (event) => {
    const data = event.data?.data();
    const email = typeof data?.email === "string" ?
      data.email.trim().toLowerCase() : "";

    if (!data || !isPlausibleEmail(email)) {
      return;
    }

    // (The "Event Registrant" Mailchimp source tag that used to be applied
    // here went with the Mailchimp sync, 2026-08-20 - tag_rules on event
    // registrations are the app's own equivalent.)

    const db = getFirestore();

    // Tag rules evaluate on EVERY registration, both branches - see
    // tag-rules.functions.ts (and the note there about the backfill-script
    // mirror contract: tagging is NOT mirrored into the scripts).
    const activity = activityFromRegistration(data, event.params.id, email);

    // The lookup and the create share one transaction - a registration and
    // a purchase from the same NEW address arriving together otherwise both
    // see "no such customer" and both create one. See findOrCreateCustomer.
    // No phone/address to seed - registrations never carry either.
    const {ref: customerRef, created, data: customer} =
      await findOrCreateCustomer(db, email, {
        firstName: data.firstName ?? "",
        lastName: data.lastName ?? "",
      });

    if (created) {
      // Brand new customer - nothing to compare against yet, so nothing is
      // ever queued as pending on creation.
      await applyTagRulesForActivity(db, activity, customerRef);
      return;
    }
    // Same reconciler the purchase trigger uses (P6) - this file's own
    // header already conceded "Otherwise identical rules"; now they are
    // identical because there is one implementation, not two that match.
    const reconciler = new CustomerReconciler(
      customer as Record<string, unknown>,
      "eventRegistration",
      event.params.id
    );

    reconciler.name("firstName", data.firstName);
    reconciler.name("lastName", data.lastName);

    const {directUpdates, pendingChanges, changed} = reconciler.result();

    if (changed) {
      await customerRef.update({...directUpdates, pendingChanges});
    }

    await applyTagRulesForActivity(db, activity, customerRef);
  }
);
