import { Timestamp } from "firebase/firestore";
import { BaseModel } from "../base.model"

export class SaleModel extends BaseModel {
  name: string;
  startDate: Timestamp | string;
  endDate: Timestamp | string;
  isActive = false;
  percentOff: number | null;
  isEvents = false;
  isProducts = false;
  isShipping = false;
}

