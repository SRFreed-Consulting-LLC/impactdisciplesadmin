import { Timestamp } from "firebase/firestore";
import { BaseModel } from "../base.model";

export class ConsultationRequestModel extends BaseModel {
  firstName: string;
  lastName: string;
  email: string;
  message: string | null;
  date: Timestamp;
}
