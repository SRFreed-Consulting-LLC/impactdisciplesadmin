import { Injectable } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { EmailList } from 'src/app/common/models/utils/email-list.model';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class EmailListService extends BaseService<EmailList>{
  constructor(public override dao: FirebaseDAO<EmailList> ) {
    super(dao)
    this.table="email_lists"
  }
}
