import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { CampaignAudience, CampaignModel, emptyCampaignStats } from 'src/app/common/models/domain/campaign.model';
import { BaseService } from './base.service';
import { CampaignEmailService } from './campaign-email.service';
import { CampaignPopupService } from './campaign-popup.service';

// What deleteCascade() is about to remove - shown in the confirm dialog.
export interface CampaignDeletePlan {
  emailCount: number;
  publishedCount: number;
  hasPopup: boolean;
  // Touches mid-flight (sending/scheduled) block deletion: the send engine
  // is still draining their ledger, and a deleted touch would strand it.
  inFlight: string[];
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
  private emailService = inject(CampaignEmailService);
  private popupService = inject(CampaignPopupService);

  constructor(public override dao: FirebaseDAO<CampaignModel> ) {
    super(dao)
    this.table="campaigns"
    this.fromFirestore = CampaignService.fromFirestore
  }

  // Campaign delete (2026-08-20). Client-side cascade over the docs staff
  // may write: every campaign_emails touch (including any published to the
  // website - they vanish from the public page with it) and the campaign's
  // campaign_popups doc, then the campaign itself. NOT touched: the
  // campaign_sends ledger and campaign_events stream (function-write-only
  // audit trails; the send engine already tolerates a missing touch, and
  // orphaned history rows are harmless) and tag_applications (customer
  // facts, not campaign data). Refuses while any touch is sending or
  // scheduled - cancel/finish those first.
  async planDelete(campaignId: string): Promise<CampaignDeletePlan> {
    const [touches, popup] = await Promise.all([
      this.emailService.getAllByValue('campaignId', campaignId),
      this.popupService.getById(campaignId).catch(() => null)
    ]);
    return {
      emailCount: touches.length,
      publishedCount: touches.filter((t) => t.publishToWeb === true).length,
      hasPopup: !!popup,
      inFlight: touches
        .filter((t) => t.status === 'sending' || t.status === 'scheduled')
        .map((t) => t.label || t.subject || t.id!)
    };
  }

  async deleteCascade(campaignId: string): Promise<void> {
    const plan = await this.planDelete(campaignId);
    if (plan.inFlight.length > 0) {
      throw new Error(`Cannot delete while emails are sending or scheduled: ${plan.inFlight.join(', ')}`);
    }
    const touches = await this.emailService.getAllByValue('campaignId', campaignId);
    for (const touch of touches) {
      await this.emailService.delete(touch.id!);
    }
    if (plan.hasPopup) {
      await this.popupService.delete(campaignId);
    }
    await this.delete(campaignId);
  }

  /** Resolves an audience server-side WITHOUT sending - the same resolver
   *  the send engine uses, so this preview can't lie. */
  async previewAudience(audience: CampaignAudience): Promise<AudiencePreview> {
    const fn = httpsCallable<{ audience: CampaignAudience }, AudiencePreview>(
      this.functions, 'previewCampaignAudience'
    );
    return (await fn({ audience })).data;
  }

  /** Reserves the per-recipient send ledger for a touch and drains the
   *  first small batch immediately; the hourly scheduler paces the rest. */
  async enqueueEmail(emailId: string): Promise<EnqueueResult> {
    const fn = httpsCallable<{ emailId: string }, EnqueueResult>(
      this.functions, 'enqueueCampaignEmail'
    );
    return (await fn({ emailId })).data;
  }

  /** Sends one rendered test copy (sample merge values, no ledger, no
   *  funnel counting). */
  async sendTestEmail(emailId: string, to: string): Promise<void> {
    const fn = httpsCallable<{ emailId: string; to: string }, { mailDocId: string }>(
      this.functions, 'sendCampaignTestEmail'
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
