import { BaseModel } from "../base.model"
import { TagModel } from "../domain/tag.model";

export class CouponModel extends BaseModel {
  isActive: boolean = false;
  code: string;
  isAffilliate: boolean = false;
  affilliateName: string;
  affiliatePaypalAccount: string;
  percentOff: number | null;
  tags?: TagModel[];
}
