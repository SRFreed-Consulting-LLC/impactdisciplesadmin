import { Injectable, inject } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { CampaignOfferModel } from '@impact-common/shared/models/utils/campaign-offer.model';
import { stripUndefinedDeep } from 'src/app/common/utils/strip-undefined';
import { BaseService } from './base.service';

// The write side of `campaign_offers` (Campaign Manager v3). One doc per
// campaign, doc id == campaignId, in a PUBLIC-readable collection - the same
// arrangement campaign_popups uses, and for the same reason: campaign docs are
// staff-only, so anything a shopper's PRICE depends on has to be published
// somewhere the storefront can read.
//
// Unlike the popup pair, both apps import ONE model from the shared submodule
// rather than keeping hand-synced copies - so an offer's shape cannot drift
// between what the admin writes and what the storefront reads.
//
// Nothing calls this yet; the wizard's offer step and the End Campaign cascade
// are its callers.
@Injectable({
  providedIn: 'root'
})
export class CampaignOfferService extends BaseService<CampaignOfferModel> {
  constructor() {
    super(inject<FirebaseDAO<CampaignOfferModel>>(FirebaseDAO));
    this.table = 'campaign_offers';
  }

  /**
   * Publishes (or replaces) a campaign's offer.
   *
   * The doc id IS the campaign id, so publishing twice updates rather than
   * accumulating - the whole point of keying by campaign. Undefined is stripped
   * because the DAO setDoc()s whole documents and Firestore rejects any nested
   * undefined (see CLAUDE.md's write gotcha).
   */
  publish(campaignId: string, offer: CampaignOfferModel): Promise<CampaignOfferModel> {
    return this.update(campaignId, stripUndefinedDeep({ ...offer, campaignId }));
  }

  /**
   * Stops a campaign's offer without deleting it.
   *
   * What the End Campaign cascade calls. Deactivating rather than deleting
   * keeps the record of what was offered - the storefront reads `isActive`, so
   * an inactive doc stops discounting immediately either way.
   */
  deactivate(campaignId: string): Promise<void> {
    return this.updateFields(campaignId, { isActive: false });
  }

  /** A campaign's offer, or null when it has none. */
  async forCampaign(campaignId: string): Promise<CampaignOfferModel | null> {
    return (await this.getById(campaignId)) ?? null;
  }
}
