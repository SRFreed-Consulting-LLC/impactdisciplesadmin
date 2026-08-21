import { Injectable } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { ProductModel } from '@impact-common/shared/models/utils/product.model';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class ProductService extends BaseService<ProductModel>{
  constructor(public override dao: FirebaseDAO<ProductModel> ) {
    super(dao)
    this.table="products"
  }
}
