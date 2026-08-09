import { Timestamp } from "firebase/firestore";
import { BaseModel } from "../base.model";

export class MonthlyNewsletterModel extends BaseModel{
  isActive = false;
  date: Date;
  title: string;
  url?: string;
}
