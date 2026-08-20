import { Injectable } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { CampaignEmailModel } from 'src/app/common/models/domain/campaign-email.model';
import { emptyEmailStats } from 'src/app/common/models/domain/campaign.model';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class CampaignEmailService extends BaseService<CampaignEmailModel>{
  constructor(public override dao: FirebaseDAO<CampaignEmailModel> ) {
    super(dao)
    this.table="campaign_emails"
    this.fromFirestore = CampaignEmailService.fromFirestore
  }

  static readonly fromFirestore = (data): CampaignEmailModel => {
    data.stats = { ...emptyEmailStats(), ...(data.stats ?? {}) };

    return data;
  };

  // Public newsletter archive flag (see CampaignEmailModel.publishToWeb).
  // PARTIAL update - a touch carries the html snapshot, link map and stats;
  // never round-trip the whole doc just to flip a flag.
  setPublishToWeb(id: string, publishToWeb: boolean, webTitle: string | null): Promise<void> {
    return this.dao.updateFields(id, this.table, { publishToWeb, webTitle });
  }
}
