import { Timestamp } from "firebase/firestore";
import { BaseModel } from "../base.model";
import { Address } from "../domain/utils/address.model";

export class WebConfigModel extends BaseModel{
  policy: string;
  tos: string
  countdownEndDateTime: Timestamp | null;
  images: string [ ] | null;
  email: string;
  phone: string;
  address: Address;
  logo: string;
  twitter: string | null;
  facebook: string | null;
  facebookLive: string | null;
  applePodCast: string | null;
  linkedIn: string | null;
  youtube: string | null;
  instagram: string | null ;
  inpersonSeminarCost: number;
  onlineSeminarCost: number;
  equippingGroupTotalCost: number;
  equippingGroupPaymentCost: number;
  adminEmailAddress: string;
  taxImportDate?: Timestamp;
  freeShippingAmount: number;
  paypalClientId?: string;
  taxApiKey? : string;
}
