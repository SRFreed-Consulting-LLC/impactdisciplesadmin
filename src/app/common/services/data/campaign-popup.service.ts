import { Injectable } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { CampaignPopupModel, PopupTemplateModel } from 'src/app/common/models/domain/campaign-popup.model';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class CampaignPopupService extends BaseService<CampaignPopupModel>{
  constructor(public override dao: FirebaseDAO<CampaignPopupModel> ) {
    super(dao)
    this.table="campaign_popups"
  }
}

@Injectable({
  providedIn: 'root'
})
export class PopupTemplateService extends BaseService<PopupTemplateModel>{
  constructor(public override dao: FirebaseDAO<PopupTemplateModel> ) {
    super(dao)
    this.table="popup_templates"
  }
}
