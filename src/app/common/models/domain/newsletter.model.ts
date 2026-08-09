import { Timestamp } from "firebase/firestore";
import { BaseModel } from "../base.model"

export class NewsletterModel extends BaseModel {
  date: Timestamp;
  sender: string;
  subject: string
  html: string
  email: string
}
