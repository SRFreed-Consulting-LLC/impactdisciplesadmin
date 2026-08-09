import { Timestamp } from "firebase/firestore";
import { BaseModel } from "../base.model";

export class AnnouncementModel extends BaseModel{
  date: Timestamp;
  title: string;
  announcement: string;
  sentBy: string;
  eventId: string;
}
