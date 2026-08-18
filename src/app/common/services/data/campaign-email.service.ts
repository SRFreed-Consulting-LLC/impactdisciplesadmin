import { Injectable } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { CampaignEmailModel } from 'src/app/common/models/domain/campaign-email.model';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class CampaignEmailService extends BaseService<CampaignEmailModel>{
  constructor(public override dao: FirebaseDAO<CampaignEmailModel> ) {
    super(dao)
    this.table="campaign_emails"
  }
}
