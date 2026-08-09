import { Timestamp } from "firebase/firestore";
import { BaseModel } from "../base.model"

export class AffilliateSaleModel extends BaseModel {
  date: Timestamp;
  code: string;
  email: string;
  receipt: any;
  totalBeforeDiscount: number | null;
  totalAfterDiscount: number | null;
  isPayed: boolean = false;
  amountPayed: number | null;
  paymentReceipt: string;
}
