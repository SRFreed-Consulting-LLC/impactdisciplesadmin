import { BaseModel } from "../base.model"
import { TagModel } from "../domain/tag.model";

export class CouponModel extends BaseModel {
  isActive = false;
  code: string;
  isAffilliate = false;
  affilliateName: string;
  affiliatePaypalAccount: string;
  percentOff: number | null;
  tags?: TagModel[];
}
