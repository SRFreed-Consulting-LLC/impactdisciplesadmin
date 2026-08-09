import { Timestamp } from "firebase/firestore";
import { BaseModel } from "../base.model"

export class AffilliatePaymentModel extends BaseModel {
  date: Timestamp;
  code: string;
  receipt: string;
  amountPayed: number | null;
  saleIdsPayed: string[];
}
