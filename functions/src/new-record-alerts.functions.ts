import {triggerPath} from "./common/shared/lists/tenancy";
import {
  onDocumentCreated,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";
import {FieldValue, getFirestore} from "firebase-admin/firestore";

// Backs the top-bar "new record" alert bell. Three source collections each
// get an onCreate/onUpdate trigger pair (below) that:
//   1. Tags every newly-created doc with newRecordStatus: "new" - this has
//      to happen server-side, in a trigger, rather than at each write site,
//      because these collections (purchases, form_submissions, and
//      event-registrations) are written by the public storefront/site, a
//      separate repo this function set has no reach into. A Firestore
//      trigger fires regardless of which app performed the write.
//   2. Keeps a single running count per source in one aggregate doc,
//      meta/newRecordCounts, so the client subscribes to one small doc
//      instead of a live listener per collection.
//
// The admin app itself is responsible for flipping newRecordStatus from
// "new" to "seen" once a record has actually been viewed (see
// src/app/shared/new-record-tracking.util.ts) - the onUpdate trigger here
// just reacts to that transition to keep the count in sync.
//
// A 4th trigger pair used to live here for the standalone `subscriptions`
// collection (fed the Subscribers screen's own row highlight only, never
// the bell itself - see git history for the old comment). Removed along
// with that collection/screen - subscriber state is now 2 flags on the
// existing "customers" doc (see customer.model.ts), which already has its
// own record lifecycle, not a "new" one of its own.

const NEW_RECORD_COUNTS_DOC = "meta/newRecordCounts";

/**
 * Builds the onCreate/onUpdate trigger pair for one source collection.
 * @param {string} collectionPath Firestore collection to watch, e.g.
 * "purchases".
 * @param {string} countField Field on meta/newRecordCounts this collection's
 * count lives in, e.g. "purchases".
 * @return {{onCreate: unknown, onUpdate: unknown}} The two Cloud Functions
 * to export for this collection.
 */
function registerNewRecordTriggers(
  collectionPath: string,
  countField: string
) {
  // Through the seam, so the three collections registered below follow
  // their data if it ever moves under the tenant. This one call covers SIX
  // deployed triggers - the factory is why they cannot drift apart.
  const docPath = triggerPath(collectionPath, "{id}");

  const onCreate = onDocumentCreated(docPath, async (event) => {
    const snap = event.data;
    const data = snap?.data();
    // Defensive - a doc that already carries newRecordStatus must not be
    // double-counted if this trigger is ever re-run.
    //
    // Sweep finding S7 (2026-08-28): this used to be load-bearing rather
    // than defensive. Three writers - the public form renderer, the
    // campaign popup, and the admin's own test-submit dialog - all set
    // newRecordStatus:'new' on create, so EVERY submission they made hit
    // this branch and was never counted. The bell did not light for real
    // public submissions at all. All three stopped sending it, and the
    // rules `hasOnly` no longer accepts it, so this trigger is the field's
    // sole writer and the check is back to being what its comment claims.
    if (!snap || !data || data.newRecordStatus) {
      return;
    }
    // A staff member testing their own form in the builder should not
    // light the alert bell. That used to happen only as a side effect of
    // the dialog pre-setting newRecordStatus; now it is stated. Harmless
    // for the other collections registered here - none of them have the
    // field.
    if (data.isTest === true) {
      return;
    }

    await snap.ref.update({newRecordStatus: "new"});
    await getFirestore().doc(NEW_RECORD_COUNTS_DOC).set(
      {[countField]: FieldValue.increment(1)},
      {merge: true}
    );
  });

  const onUpdate = onDocumentUpdated(docPath, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    // Only a "new" -> anything-else transition clears one from the count -
    // every doc is counted at most once (on creation), so this is the only
    // write that should ever decrement it.
    if (before?.newRecordStatus === "new" && after?.newRecordStatus !== "new") {
      await getFirestore().doc(NEW_RECORD_COUNTS_DOC).set(
        {[countField]: FieldValue.increment(-1)},
        {merge: true}
      );
    }
  });

  return {onCreate, onUpdate};
}

const eventRegistrations =
  registerNewRecordTriggers("event-registrations", "eventRegistrations");
// Replaces the old per-request-type triggers (consultation_requests,
// consultation_surveys, lunch_and_learns, seminars) - those 4 collections'
// admin screens were removed in favor of the generic Form Builder + Custom
// Form Submissions pair (Web Manager), which all submissions now flow
// through regardless of which form was filled out. One trigger on
// form_submissions covers all of them going forward; the 4 old collections
// still exist with whatever data they already had; but nothing writes to
// them any more so their triggers were removed rather than left running.
const formSubmissions =
  registerNewRecordTriggers("form_submissions", "formSubmissions");
const purchases = registerNewRecordTriggers("purchases", "purchases");

export const onEventRegistrationCreated = eventRegistrations.onCreate;
export const onEventRegistrationUpdated = eventRegistrations.onUpdate;
export const onFormSubmissionCreated = formSubmissions.onCreate;
export const onFormSubmissionUpdated = formSubmissions.onUpdate;
export const onPurchaseCreated = purchases.onCreate;
export const onPurchaseUpdated = purchases.onUpdate;
