import { CustomerModel, SubscriptionType } from 'src/app/common/models/domain/utils/customer.model';

// Flat, screen-specific row - not the underlying Firestore document. Split
// into its own file (rather than living on subscriptions.component.ts,
// which is where it conceptually belongs) purely so the 3 subscriptions/
// dialog components can import the type without a circular
// component-to-component import back to SubscriptionsComponent itself.
export interface SubscriberRow {
  // Synthetic - `${customer.id}:${type}`, NOT a real Firestore document id.
  // A customer subscribed to both Newsletter and Prayer Team is one
  // `customers` doc now (see customer.model.ts), not 2 separate records -
  // this screen still shows one row per subscription *type* though (same
  // shape the old subscriptions collection had), so a doubly-subscribed
  // customer legitimately produces 2 rows sharing one `customer`.
  id: string;
  type: SubscriptionType;
  firstName: string;
  lastName: string;
  email: string;
  date: Date | null;
  // The full backing customer record - required (not just its id) because
  // FirebaseDAO.update() is a plain setDoc(), not a merge (see its own
  // comment) - flipping one flag on this customer means writing the WHOLE
  // record back, so every action that mutates a row needs it on hand rather
  // than re-fetching.
  customer: CustomerModel;
}
