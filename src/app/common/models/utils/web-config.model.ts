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
  // paypalClientId is a public client identifier, safe to keep here. Secrets
  // are not: `config` is world-readable under the current firestore.rules, so
  // anything stored here is effectively published. The apilayer tax key used
  // to live on this model and now comes from Secret Manager (TAX_API_KEY) in
  // checkout-pricing.functions.ts instead. House rule: keys never go in
  // Firestore.
  paypalClientId?: string;
  // PUBLIC social identity for the campaign social composer's previews and
  // manual posting (page name / @handles only). Same rule as paypalClientId
  // above: this config is world-readable, so social API tokens/secrets must
  // never go here - a future auto-publish phase keeps them in Secret
  // Manager on the functions side.
  socialFacebookPageName?: string | null;
  socialTwitterHandle?: string | null;
  socialInstagramHandle?: string | null;
}
