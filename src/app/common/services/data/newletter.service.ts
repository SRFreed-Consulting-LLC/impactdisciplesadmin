import { Injectable } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { NewsletterModel } from 'src/app/common/models/domain/newsletter.model';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class NewsletterService extends BaseService<NewsletterModel>{
  constructor(public override dao: FirebaseDAO<NewsletterModel> ) {
    super(dao)
    this.table="newsletters"
  }
}
