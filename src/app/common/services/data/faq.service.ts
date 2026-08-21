import { Injectable } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { FAQModel } from '@impact-common/shared/models/utils/faq.model';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class FAQService extends BaseService<FAQModel>{
  constructor(public override dao: FirebaseDAO<FAQModel> ) {
    super(dao)
    this.table="faq"
  }
}
