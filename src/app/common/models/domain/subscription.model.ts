import { Timestamp } from "firebase/firestore"
import { BaseModel } from "../base.model"

// Newsletter and Prayer Team subscribers, merged into one collection
// (`subscriptions`) - see nav-config.ts's 'customers-manager' comment and
// subscriptions.component.ts for the merge rationale. `type` is the only
// thing distinguishing the two; every other field was already identical
// across the two former collections, which is exactly why they merged.
export type SubscriptionType = 'newsletter' | 'prayer';

export class SubscriptionModel extends BaseModel {
  type: SubscriptionType;
  firstName: string
  lastName: string
  email: string
  date: Timestamp;
  // Drives NewRecordTracker's row highlight on the Subscribers screen - see
  // new-record-tracking.util.ts. Field name/values match NewRecordTrackable
  // exactly. Stamped server-side by functions/src/new-record-alerts.
  // functions.ts's onCreate trigger on the `subscriptions` collection, the
  // same way purchases/form_submissions/event-registrations are (this
  // collection is written by the public site, a separate repo, not by any
  // Cloud Function of this app's own).
  newRecordStatus?: 'new' | 'seen';
}
