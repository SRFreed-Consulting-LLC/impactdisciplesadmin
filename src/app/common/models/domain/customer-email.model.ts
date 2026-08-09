import { Timestamp } from "firebase/firestore";
import { BaseModel } from "../base.model"

export class CustomerEmailModel extends BaseModel {
  date: Timestamp;
  sender: string;
  subject: string
  html: string
  email: string
}
