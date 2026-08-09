import { Timestamp } from "firebase/firestore"
import { Address } from "./utils/address.model"
import { BaseModel } from "../base.model";
import { Phone } from "./utils/phone.model";

export class LunchAndLearnModel extends BaseModel{
  date: Timestamp;
  dateString: string;
  email: string;
  firstName: string;
  lastName: string;
  requestedDate: Timestamp;
  requestedDateString: string;
  requestedStartTime: Timestamp;
  requestedStartTimeString: string;
  requestedEndTime: Timestamp;
  requestedEndTimeString: string;
  locationName: string;
  locationAddress: Address;
  coordinator: string;
  coordinatorPhone: Phone;
}
