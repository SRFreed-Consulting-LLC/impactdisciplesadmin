import { Timestamp } from "firebase/firestore";
import { BaseModel } from "../base.model"

export class SaleModel extends BaseModel {
  name: string;
  startDate: Timestamp | string;
  endDate: Timestamp | string;
  isActive: boolean = false;
  percentOff: number | null;
  isEvents: boolean = false;
  isProducts: boolean = false;
  isShipping: boolean = false;
}

