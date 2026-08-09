import { Injectable } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { CouponModel } from 'src/app/common/models/utils/coupon.model';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class CouponService extends BaseService<CouponModel> {
  constructor(public override dao: FirebaseDAO<CouponModel>) {
    super(dao)
    this.table="coupons"
  }
}
