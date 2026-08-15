import { CustomerModel, SubscriptionType } from 'src/app/common/models/domain/utils/customer.model';

// Intermediate shape runQuery() produces - a customer + which flag matched
// it - kept separate from ReportRow below so both can carry `type`
// independently.
export interface SubscriberQueryRow {
  customer: CustomerModel;
  type: SubscriptionType;
}

// Flat, report-specific row shape - one per (customer, type) match, never
// an aggregate (no Group by Type mode any more - see this component's own
// header comment). Split into its own file (rather than living directly
// on subscriber-report.component.ts) purely so subscriber-dialog.
// component.ts can import it without a circular component-to-component
// import back to SubscriberReportComponent itself.
export interface ReportRow {
  id: string;
  type: SubscriptionType;
  firstName: string;
  lastName: string;
  email: string;
  typeLabel: string;
  date: Date | null;
  // The full backing customer record - required (not just an id) because
  // FirebaseDAO.update() is a plain setDoc(), not a merge - flipping one
  // flag on this customer means writing the WHOLE record back, so every
  // action that mutates a row needs it on hand rather than re-fetching.
  customer: CustomerModel;
}
