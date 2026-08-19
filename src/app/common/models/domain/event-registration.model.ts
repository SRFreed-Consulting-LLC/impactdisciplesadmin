import { Timestamp } from "firebase/firestore";
import { BaseModel } from "../base.model";

export class EventRegistrationModel extends BaseModel{
  firstName: string;
  lastName: string;
  // Case-insensitive sort key for the admin Attendees table's server-side
  // orderBy (Firestore sorts by code point, so "williams" would outrank
  // "Zonn"). Stamped by registerForEventHttp and the admin attendee dialog;
  // backfilled by scripts/backfill-registration-lastname-lower.js.
  lastNameLower?: string;
  eventId: string;
  email: string;
  receipt: string;
  registrationDate: Timestamp | Date | string;
  trainingSessions: string [];
  loggedIn?: boolean = false;
  receiptEmailId?: string;
  receiptEmailStatus: string;
  receiptEmailDate: Timestamp | Date | string;
  // Set by the new-record-alert Cloud Function trigger on creation ('new'),
  // flipped to 'seen' by new-record-tracking.util.ts the first time an admin
  // views this record - see functions/src/new-record-alerts.functions.ts.
  newRecordStatus?: 'new' | 'seen';
}
