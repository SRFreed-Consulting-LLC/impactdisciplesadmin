import { Timestamp } from "firebase/firestore"
import { BaseModel } from "../base.model"

export class PrayerTeamSubscriptionModel extends BaseModel {
  firstName: string
  lastName: string
  email: string
  date: Timestamp;
}
