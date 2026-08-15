import { CustomerModel, SubscriptionType } from 'src/app/common/models/domain/utils/customer.model';

// Intermediate shape runQuery() produces - a customer + which flag matched
// it - kept separate from ReportRow below so aggregateByType still has a
// real `type` to group on (ReportRow only carries the display label).
export interface SubscriberQueryRow {
  customer: CustomerModel;
  type: SubscriptionType;
}

// Flat, report-specific row shape - see purchase-report.component.ts's own
// comment on why (identical reasoning: a "Group by Type" row is a
// synthesized aggregate over several subscribers, not one real document).
// Split into its own file (rather than living directly on
// subscriber-report.component.ts) purely so subscriber-dialog.component.ts
// can import it without a circular component-to-component import back to
// SubscriberReportComponent itself - same reason the old Subscribers
// screen's SubscriberRow got its own file.
export interface ReportRow {
  id: string;
  type: SubscriptionType;
  firstName: string;
  lastName: string;
  email: string;
  typeLabel: string;
  date: Date | null;
  // Grouped-mode-only - blank/0 when ungrouped.
  subscriberCount: number;
  earliestDate: Date | null;
  latestDate: Date | null;
  // The full backing customer record - present only on real, ungrouped
  // rows (undefined for a type-level aggregate row, which doesn't
  // correspond to any single document). Required (not just an id) because
  // FirebaseDAO.update() is a plain setDoc(), not a merge - flipping one
  // flag on this customer means writing the WHOLE record back, so every
  // action that mutates a row needs it on hand rather than re-fetching.
  customer?: CustomerModel;
}
