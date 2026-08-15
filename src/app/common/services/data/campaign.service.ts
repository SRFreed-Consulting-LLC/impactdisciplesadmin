import { Injectable } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { CampaignModel, emptyCampaignStats } from 'src/app/common/models/domain/campaign.model';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class CampaignService extends BaseService<CampaignModel>{
  constructor(public override dao: FirebaseDAO<CampaignModel> ) {
    super(dao)
    this.table="campaigns"
    this.fromFirestore = CampaignService.fromFirestore
  }

  // Older/hand-created docs may predate the stats block - normalize so no
  // screen ever has to null-check 6 counters.
  static readonly fromFirestore = (data): CampaignModel => {
    data.stats = { ...emptyCampaignStats(), ...(data.stats ?? {}) };

    return data;
  };
}
