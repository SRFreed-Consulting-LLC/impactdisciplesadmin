import { Injectable } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { BaseService } from './base.service';
import { SaleModel } from 'src/app/common/models/utils/sale.model';

@Injectable({
  providedIn: 'root'
})
export class SalesService extends BaseService<SaleModel> {
  constructor(public override dao: FirebaseDAO<SaleModel>) {
    super(dao)
    this.table="sales"
  }
}
