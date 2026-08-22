import { Injectable, inject } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { CampaignOfferModel, OfferTarget } from '@impact-common/shared/models/utils/campaign-offer.model';
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

  /**
   * Live offers that would discount the same thing as this one.
   *
   * Powers the activation warning. Scoped to overlapping DISCOUNTS on purpose:
   * two campaigns promoting the same product is good marketing, not a
   * conflict, and warning about that would train people to dismiss the warning.
   *
   * A product offer and a series offer collide when the product belongs to the
   * series, so the caller supplies a lookup - the check has to resolve BOTH
   * directions, and only the caller knows the catalogue.
   *
   * This cannot catch everything: moving a product INTO a discounted series
   * later collides with nobody touching either campaign. Known limitation of
   * checking at activation, recorded rather than solved.
   *
   * @param seriesOf Series id a product belongs to, or null.
   */
  async findConflicts(
    campaignId: string,
    target: OfferTarget,
    seriesOf: (productId: string) => string | null
  ): Promise<CampaignOfferModel[]> {
    const live = await this.getAllByValue('isActive', true);

    return live.filter((other) => {
      const theirs = other.target;
      if (other.campaignId === campaignId || !theirs || !target) {
        return false;
      }
      if (target.kind === theirs.kind) {
        return target.id === theirs.id;
      }
      if (target.kind === 'product' && theirs.kind === 'series') {
        return seriesOf(target.id) === theirs.id;
      }
      if (target.kind === 'series' && theirs.kind === 'product') {
        return seriesOf(theirs.id) === target.id;
      }
      // An event never collides with a product or a series.
      return false;
    });
  }

  /** A campaign's offer, or null when it has none. */
  async forCampaign(campaignId: string): Promise<CampaignOfferModel | null> {
    return (await this.getById(campaignId)) ?? null;
  }
}
