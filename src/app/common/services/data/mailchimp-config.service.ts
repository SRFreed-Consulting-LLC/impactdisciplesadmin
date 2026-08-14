import { Injectable } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { MailchimpConfigModel } from 'src/app/common/models/utils/mailchimp-config.model';
import { BaseService } from './base.service';

// Singleton settings doc, one fixed id ('mailchimp') in its own collection -
// deliberately not the 'config' collection WebConfigService owns, since
// WebConfigComponent assumes exactly one doc lives there (see its own
// comment). getConfig()/saveConfig() wrap that fixed id so callers never
// need to know/pass it.
@Injectable({
  providedIn: 'root'
})
export class MailchimpConfigService extends BaseService<MailchimpConfigModel> {
  private static readonly DOC_ID = 'mailchimp';

  constructor(public override dao: FirebaseDAO<MailchimpConfigModel>) {
    super(dao);
    this.table = 'integration_settings';
  }

  getConfig(): Promise<MailchimpConfigModel> {
    return this.getById(MailchimpConfigService.DOC_ID);
  }

  // update() does a setDoc under the hood (see FirebaseDAO.update) - creates
  // the doc on first save, replaces it on every save after, no separate
  // add() branch needed.
  saveConfig(value: MailchimpConfigModel): Promise<MailchimpConfigModel> {
    return this.update(MailchimpConfigService.DOC_ID, value);
  }
}
