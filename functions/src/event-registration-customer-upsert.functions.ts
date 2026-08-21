import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {Timestamp, getFirestore} from "firebase-admin/firestore";
import {
  isPlausibleEmail,
  normalizedName,
} from "./utils/customer-match.functions";
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

type PendingField = "firstName" | "lastName";

interface PendingCustomerChange {
  field: PendingField;
  currentValue: unknown;
  proposedValue: unknown;
  source: "purchase" | "eventRegistration";
  sourceId: string;
  detectedDate: Timestamp;
}

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
    const existingSnap = await db.collection("customers")
      .where("email", "==", email)
      .limit(1)
      .get();

    // Tag rules evaluate on EVERY registration, both branches - see
    // tag-rules.functions.ts (and the note there about the backfill-script
    // mirror contract: tagging is NOT mirrored into the scripts).
    const activity = activityFromRegistration(data, event.params.id, email);

    if (existingSnap.empty) {
      // Brand new customer - nothing to compare against yet, so nothing is
      // ever queued as pending on creation. No phone/address to seed -
      // registrations never carry either.
      const newRef = await db.collection("customers").add({
        firstName: data.firstName ?? "",
        lastName: data.lastName ?? "",
        email,
        role: "Customer",
        notes: [],
        pendingChanges: [],
        tags: [],
      });
      await applyTagRulesForActivity(db, activity, newRef);
      return;
    }

    const customerDoc = existingSnap.docs[0];
    const customer = customerDoc.data();
    const existingPending = customer.pendingChanges;
    const pending: PendingCustomerChange[] =
      Array.isArray(existingPending) ? [...existingPending] : [];
    const now = Timestamp.now();
    const directUpdates: Record<string, unknown> = {};
    let changed = false;

    const resolveNameField = (
      field: PendingField,
      proposedRaw: unknown
    ) => {
      const proposed =
        typeof proposedRaw === "string" ? proposedRaw.trim() : "";
      if (!proposed) {
        return;
      }
      const currentValue = customer[field];
      if (!normalizedName(currentValue)) {
        directUpdates[field] = proposed;
        changed = true;
        return;
      }
      if (normalizedName(currentValue) === normalizedName(proposed)) {
        return;
      }
      const entry: PendingCustomerChange = {
        field,
        currentValue: currentValue ?? null,
        proposedValue: proposed,
        source: "eventRegistration",
        sourceId: event.params.id,
        detectedDate: now,
      };
      const idx = pending.findIndex((p) => p.field === field);
      if (idx >= 0) {
        pending[idx] = entry;
      } else {
        pending.push(entry);
      }
      changed = true;
    };

    resolveNameField("firstName", data.firstName);
    resolveNameField("lastName", data.lastName);

    if (changed) {
      await customerDoc.ref.update({...directUpdates, pendingChanges: pending});
    }

    await applyTagRulesForActivity(db, activity, customerDoc.ref);
  }
);
