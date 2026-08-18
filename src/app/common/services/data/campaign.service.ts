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

  // Normalizes any doc to the v2 shape so no screen ever null-checks the
  // counters or the goal/channels fields (see campaign.model.ts's header
  // for the v2 model; scripts/apply-campaign-regroup.js writes v2 docs).
  static readonly fromFirestore = (data): CampaignModel => {
    data.stats = { ...emptyCampaignStats(), ...(data.stats ?? {}) };
    data.goal = data.goal ?? 'other';
    data.channels = data.channels ?? ['email'];

    return data;
  };
}
