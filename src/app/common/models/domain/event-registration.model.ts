import { Timestamp } from "firebase/firestore";
import { BaseModel } from "../base.model";

export class EventRegistrationModel extends BaseModel{
  firstName: string;
  lastName: string;
  eventId: string;
  email: string;
  receipt: string;
  registrationDate: Timestamp | any;
  trainingSessions: string [];
  loggedIn?: boolean = false;
  receiptEmailId?: string;
  receiptEmailStatus: string;
  receiptEmailDate: Timestamp | any;
  // Set by the new-record-alert Cloud Function trigger on creation ('new'),
  // flipped to 'seen' by new-record-tracking.util.ts the first time an admin
  // views this record - see functions/src/new-record-alerts.functions.ts.
  newRecordStatus?: 'new' | 'seen';
}
