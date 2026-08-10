import { Timestamp } from "firebase/firestore";
import { BaseModel } from "../base.model";

export class DMMModel extends BaseModel {
  isActive = false;
  title: string;
  date: Timestamp | Date;
  text: string;
}
