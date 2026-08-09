import {
  onDocumentCreated,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";

// Backs the top-bar "new record" alert bell in the admin app. Six source
// collections each get an onCreate/onUpdate trigger pair (below) that:
//   1. Tags every newly-created doc with newRecordStatus: "new" - this has
//      to happen server-side, in a trigger, rather than at each write site,
//      because several of these collections (purchases, and possibly some
//      Requests Manager submissions) are written by the public storefront/
//      site, a separate repo this function set has no reach into. A
//      Firestore trigger fires regardless of which app performed the write.
//   2. Keeps a single running count per source in one aggregate doc,
//      meta/newRecordCounts, so the client subscribes to one small doc
//      instead of a live listener per collection.
//
// The admin app itself is responsible for flipping newRecordStatus from
// "new" to "seen" once a record has actually been viewed (see
// src/app/shared/new-record-tracking.util.ts) - the onUpdate trigger here
// just reacts to that transition to keep the count in sync.

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
  const docPath = `${collectionPath}/{id}`;

  const onCreate = onDocumentCreated(docPath, async (event) => {
    const snap = event.data;
    const data = snap?.data();
    // Defensive - shouldn't happen on a create event, but a doc already
    // carrying newRecordStatus (e.g. written directly by this admin app,
    // which sets other fields but not this one today) shouldn't be
    // double-counted if this trigger is ever re-run.
    if (!snap || !data || data.newRecordStatus) {
      return;
    }

    await snap.ref.update({newRecordStatus: "new"});
    await admin.firestore().doc(NEW_RECORD_COUNTS_DOC).set(
      {[countField]: admin.firestore.FieldValue.increment(1)},
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
      await admin.firestore().doc(NEW_RECORD_COUNTS_DOC).set(
        {[countField]: admin.firestore.FieldValue.increment(-1)},
        {merge: true}
      );
    }
  });

  return {onCreate, onUpdate};
}

const eventRegistrations =
  registerNewRecordTriggers("event-registrations", "eventRegistrations");
const consultationRequests =
  registerNewRecordTriggers("consultation_requests", "consultationRequests");
const consultationSurveys =
  registerNewRecordTriggers("consultation_surveys", "consultationSurveys");
const lunchAndLearns =
  registerNewRecordTriggers("lunch_and_learns", "lunchAndLearns");
const seminars = registerNewRecordTriggers("seminars", "seminars");
const purchases = registerNewRecordTriggers("purchases", "purchases");

export const onEventRegistrationCreated = eventRegistrations.onCreate;
export const onEventRegistrationUpdated = eventRegistrations.onUpdate;
export const onConsultationRequestCreated = consultationRequests.onCreate;
export const onConsultationRequestUpdated = consultationRequests.onUpdate;
export const onConsultationSurveyCreated = consultationSurveys.onCreate;
export const onConsultationSurveyUpdated = consultationSurveys.onUpdate;
export const onLunchAndLearnCreated = lunchAndLearns.onCreate;
export const onLunchAndLearnUpdated = lunchAndLearns.onUpdate;
export const onSeminarCreated = seminars.onCreate;
export const onSeminarUpdated = seminars.onUpdate;
export const onPurchaseCreated = purchases.onCreate;
export const onPurchaseUpdated = purchases.onUpdate;
