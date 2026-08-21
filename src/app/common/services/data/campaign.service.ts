import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { CampaignAudience, CampaignModel, emptyCampaignStats } from 'src/app/common/models/domain/campaign.model';
import { BaseService } from './base.service';
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
  private functions = inject(Functions);

  constructor(public override dao: FirebaseDAO<CampaignModel> ) {
    super(dao)
    this.table="campaigns"
    this.fromFirestore = CampaignService.fromFirestore
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
  static readonly fromFirestore = (data): CampaignModel => {
    data.stats = { ...emptyCampaignStats(), ...(data.stats ?? {}) };
    data.goal = data.goal ?? 'other';
    data.channels = data.channels ?? ['email'];

    return data;
  };
}
