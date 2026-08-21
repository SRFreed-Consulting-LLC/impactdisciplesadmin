import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { CampaignAudience, CampaignModel, emptyCampaignStats } from 'src/app/common/models/domain/campaign.model';
import { BaseService } from './base.service';
import { CALLABLE_FUNCTIONS } from '@impact-common/shared/contract/functions-contract';

// What deleteCascade() is about to remove - shown in the confirm dialog
// (the deleteCampaign callable's dryRun result).
export interface CampaignDeletePlan {
  name: string;
  emailCount: number;
  publishedCount: number;
  hasPopup: boolean;
  // Touches mid-flight (sending/scheduled) block deletion: the send engine
  // is still draining their ledger, and a deleted touch would strand it.
  inFlight: string[];
  // Storage images referenced by the campaign/its emails/its popup; the
  // ones nothing else references are deleted with it.
  imageCandidates: number;
}

export interface CampaignDeleteResult {
  emailsDeleted: number;
  popupDeleted: boolean;
  imagesDeleted: string[];
  imagesKept: string[];
  imagesFailed: string[];
}

// Result shapes of the send-engine callables
// (functions/src/campaign-send.functions.ts).
export interface AudiencePreview {
  count: number;
  sample: string[];
}
export interface EnqueueResult {
  recipients: number;
  queued: number;
  sentImmediately: number;
}

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
    const call = httpsCallable<{ campaignId: string; dryRun: boolean }, CampaignDeletePlan>(this.functions, CALLABLE_FUNCTIONS.deleteCampaign);
    return (await call({ campaignId, dryRun: true })).data;
  }

  async deleteCascade(campaignId: string): Promise<CampaignDeleteResult> {
    const call = httpsCallable<{ campaignId: string; dryRun: boolean }, CampaignDeleteResult>(this.functions, CALLABLE_FUNCTIONS.deleteCampaign);
    return (await call({ campaignId, dryRun: false })).data;
  }

  /** Resolves an audience server-side WITHOUT sending - the same resolver
   *  the send engine uses, so this preview can't lie. */
  async previewAudience(audience: CampaignAudience): Promise<AudiencePreview> {
    const fn = httpsCallable<{ audience: CampaignAudience }, AudiencePreview>(
      this.functions, CALLABLE_FUNCTIONS.previewCampaignAudience
    );
    return (await fn({ audience })).data;
  }

  /** Reserves the per-recipient send ledger for a touch and drains the
   *  first small batch immediately; the hourly scheduler paces the rest. */
  async enqueueEmail(emailId: string): Promise<EnqueueResult> {
    const fn = httpsCallable<{ emailId: string }, EnqueueResult>(
      this.functions, CALLABLE_FUNCTIONS.enqueueCampaignEmail
    );
    return (await fn({ emailId })).data;
  }

  /** Sends one rendered test copy (sample merge values, no ledger, no
   *  funnel counting). */
  async sendTestEmail(emailId: string, to: string): Promise<void> {
    const fn = httpsCallable<{ emailId: string; to: string }, { mailDocId: string }>(
      this.functions, CALLABLE_FUNCTIONS.sendCampaignTestEmail
    );
    await fn({ emailId, to });
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
