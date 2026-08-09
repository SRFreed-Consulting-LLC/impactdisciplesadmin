import { Timestamp } from 'firebase/firestore';
import { BaseModel } from '../base.model';

export class HomePagePopupModel extends BaseModel {
  isActive = false;
  fromDate?: Timestamp | Date | string;
  toDate?: Timestamp | Date | string;
  title: string;
  text?: string;
  width?: number;
  height?: number;
  bgColor?: string;
}
