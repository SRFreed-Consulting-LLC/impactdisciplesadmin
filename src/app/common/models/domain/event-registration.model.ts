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
}
