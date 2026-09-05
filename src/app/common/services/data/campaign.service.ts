import { Injectable } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import {
  CampaignAudience,
  CampaignModel,
  CampaignStatus,
  emptyCampaignStats
} from 'src/app/common/models/domain/campaign.model';
import { BaseService } from './base.service';
import { CampaignPopupService } from './campaign-popup.service';
import { CampaignOfferService } from './campaign-offer.service';
import { CouponService } from './coupon.service';
import { CALLABLE_FUNCTIONS } from '@impact-common/shared/contract/functions-contract';
import {
  CampaignDeletePlan,
  CampaignDeleteResult,
  DeleteCampaignRequest,
  DeleteCampaignResult,
  EnqueueCampaignEmailRequest,
  EnqueueCampaignEmailResult,
  PreviewCampaignAudienceRequest,
  PreviewCampaignAudienceResult,
  SendCampaignTestEmailRequest,
  SendCampaignTestEmailResult,
} from '@impact-common/shared/contract/admin-callables.types';

// What deleteCascade() is about to remove - shown in the confirm dialog
// (the deleteCampaign callable's dryRun result).


// Result shapes of the send-engine callables
// (functions/src/campaign-send.functions.ts).
/** Alias of the shared contract's PreviewCampaignAudienceResult (Stage 2e-ii). */
export type AudiencePreview = PreviewCampaignAudienceResult;
/** Alias of the shared contract's EnqueueCampaignEmailResult (Stage 2e-ii). */
export type EnqueueResult = EnqueueCampaignEmailResult;

export type { CampaignDeletePlan } from '@impact-common/shared/contract/admin-callables.types';

export type { CampaignDeleteResult } from '@impact-common/shared/contract/admin-callables.types';

@Injectable({
  providedIn: 'root'
})
export class CampaignService extends BaseService<CampaignModel>{
  // Same field-inject pattern TagRuleService/PurchasesService use.
  constructor(
    public override dao: FirebaseDAO<CampaignModel>,
    private functions: Functions,
    private popupService: CampaignPopupService,
    private offerService: CampaignOfferService,
    private couponService: CouponService
  ) {
    super(dao)
    this.table="campaigns"
    this.fromFirestore = CampaignService.fromFirestore
  }

  // ---------------------------------------------------------------------
  // Lifecycle (sweep finding R1)
  // ---------------------------------------------------------------------
  //
  // Activating and ending a campaign are not one write each - they are the
  // campaign's write-side invariants, and they used to live inside
  // CampaignDetailComponent. That meant they could not be reused by a
  // script or a bulk action, and could not be tested without standing up
  // the component. They live here now; the component keeps the parts that
  // are genuinely UI (permission checks, confirms, snackbars, navigation).

  /**
   * Moves a campaign to `next` and brings its published offer with it, in
   * ONE batch.
   *
   * THE BATCH IS THE POINT, not an optimisation. These used to be two
   * sequential awaits with the status chip flipping optimistically between
   * them: navigating away in that window - or any failure on the second
   * write - left the campaign LIVE advertising a discount that had never
   * started. Nothing recomputed it afterwards, so the only symptom was a
   * shopper being charged full price on a campaign that said it was
   * running. Do not split this back into two writes.
   *
   * The offer carries its own active flag because the storefront cannot
   * read a campaign to find out whether one is running. Only a genuinely
   * live campaign discounts; a scheduled one waits.
   */
  async activateTo(
    campaignId: string,
    next: CampaignStatus,
    opts: { clearEndDate?: boolean } = {}
  ): Promise<void> {
    const offer = await this.offerService.forCampaign(campaignId);

    const batch = this.dao.batch();
    // clearEndDate rides in the SAME batch as the status on purpose. Reopening
    // an ended campaign is only meaningful if both land: effectiveStatus()
    // derives 'ended' from a past end date as well as from the stored field,
    // so a status write that succeeded while the date write failed would leave
    // the campaign reading as ended and the button looking broken.
    // null, not a deleted key - a null endDate already means "long-running
    // series" in this model, which is exactly what a reopened campaign is.
    this.dao.batchUpdateFields(batch, campaignId, 'campaigns', {
      status: next,
      ...(opts.clearEndDate ? { endDate: null } : {})
    });
    if (offer) {
      this.dao.batchUpdateFields(
        batch, campaignId, 'campaign_offers', { isActive: next === 'live' }
      );
    }
    await batch.commit();
  }

  /**
   * Ends the campaign and everything it is still doing, returning the
   * names of anything it could not stop.
   *
   * The cascade is the whole point: a campaign marked ended whose popup
   * keeps showing and whose discount keeps applying is worse than no
   * button at all. The status write comes first and THROWS on failure -
   * if that does not land the campaign is not ended and the caller must
   * say so. Everything after it is best-effort and reported by name, so a
   * single failure cannot leave the campaign ended with its discount live
   * and nobody told.
   */
  async endCascade(campaign: CampaignModel, endedAt: Date): Promise<string[]> {
    await this.updateFields(campaign.id!, {
      status: 'ended',
      endDate: endedAt
    });

    const failures: string[] = [];

    // Read rather than trusting a caller to have loaded it: the popup doc
    // is keyed by the campaign id, and a caller that had not loaded it
    // used to leave the popup running.
    try {
      const popup = await this.popupService.getById(campaign.id!);
      if (popup) {
        await this.popupService.updateFields(campaign.id!, { isActive: false });
      }
    } catch {
      failures.push('popup');
    }

    try {
      const offer = await this.offerService.forCampaign(campaign.id!);
      if (offer) {
        await this.offerService.deactivate(campaign.id!);
      }
    } catch {
      failures.push('discount');
    }

    if (campaign.couponId) {
      try {
        await this.couponService.updateFields(campaign.couponId, { isActive: false });
      } catch {
        failures.push('coupon');
      }
    }

    return failures;
  }

  // Stamps when the campaign was MADE. Deliberately here and not in
  // BaseService.add(): every collection in the app would inherit a new
  // field otherwise, and only campaigns need one today. An explicit
  // createdAt on the incoming value wins, so an import/migration can keep
  // the original date.
  // ONE live campaign per product, and one per event (2026-08-25, owner
  // rule). Drafts and scheduled campaigns do NOT reserve a target - you can
  // build several and only the one you activate holds it. goal 'other' has
  // no target and is never constrained. A series is just whatever product
  // was picked - deliberately NOT expanded to its members.
  //
  // CLIENT-SIDE ONLY, and advisory by design: a script, import, or any
  // future writer can still create a second live campaign. This stops the
  // mistake in the UI; it does not make the invariant guaranteed.
  async findLiveCampaignFor(
    goal: CampaignModel['goal'],
    targetId: string | null | undefined,
    excludeCampaignId?: string | null
  ): Promise<CampaignModel | null> {
    if (!targetId || (goal !== 'product' && goal !== 'event')) {
      return null;
    }
    const field = goal === 'product' ? 'productId' : 'eventId';
    const matches = await this.getAllByValue(field, targetId);
    return matches.find((c) => c.status === 'live' && c.id !== excludeCampaignId) ?? null;
  }

  override add(value: CampaignModel): Promise<CampaignModel> {
    return super.add({ ...value, createdAt: value.createdAt ?? new Date() });
  }

  // Campaign delete (2026-08-20) - server-side via the deleteCampaign
  // callable (functions/src/campaign-admin.functions.ts): cascades the
  // campaign's emails (incl. website-published ones) and popup, then the
  // campaign, then removes from Storage every image those docs referenced
  // that nothing else in the database still references (full content-
  // collection scan - the reason it's a function, not a client loop).
  // NOT touched: campaign_sends / campaign_events (function-owned audit)
  // and tag_applications (customer facts). Refuses while any email is
  // sending or scheduled.
  async planDelete(campaignId: string): Promise<CampaignDeletePlan> {
    const call = httpsCallable<DeleteCampaignRequest, DeleteCampaignResult>(this.functions, CALLABLE_FUNCTIONS.deleteCampaign);
    return (await call({ campaignId, dryRun: true })).data as CampaignDeletePlan;
  }

  async deleteCascade(campaignId: string): Promise<CampaignDeleteResult> {
    const call = httpsCallable<DeleteCampaignRequest, DeleteCampaignResult>(this.functions, CALLABLE_FUNCTIONS.deleteCampaign);
    return (await call({ campaignId, dryRun: false })).data as CampaignDeleteResult;
  }

  /** Resolves an audience server-side WITHOUT sending - the same resolver
   *  the send engine uses, so this preview can't lie. */
  async previewAudience(audience: CampaignAudience): Promise<AudiencePreview> {
    const fn = httpsCallable<PreviewCampaignAudienceRequest, PreviewCampaignAudienceResult>(
      this.functions, CALLABLE_FUNCTIONS.previewCampaignAudience
    );
    return (await fn({ audience })).data;
  }

  /** Reserves the per-recipient send ledger for a touch and drains the
   *  first small batch immediately; the hourly scheduler paces the rest. */
  async enqueueEmail(emailId: string): Promise<EnqueueResult> {
    const fn = httpsCallable<EnqueueCampaignEmailRequest, EnqueueCampaignEmailResult>(
      this.functions, CALLABLE_FUNCTIONS.enqueueCampaignEmail
    );
    return (await fn({ emailId })).data;
  }

  /** Sends one rendered test copy (sample merge values, no ledger, no
   *  funnel counting). */
  async sendTestEmail(emailId: string, to: string): Promise<void> {
    const fn = httpsCallable<SendCampaignTestEmailRequest, SendCampaignTestEmailResult>(
      this.functions, CALLABLE_FUNCTIONS.sendCampaignTestEmail
    );
    await fn({ emailId, to });
  }

  // Normalizes any doc to the v2 shape so no screen ever null-checks the
  // counters or the goal/channels fields (see campaign.model.ts's header
  // for the v2 model; apply-campaign-regroup.js (removed) writes v2 docs).
  static readonly fromFirestore = (data: CampaignModel): CampaignModel => {
    data.stats = { ...emptyCampaignStats(), ...(data.stats ?? {}) };
    data.goal = data.goal ?? 'other';
    data.channels = data.channels ?? ['email'];

    return data;
  };
}
