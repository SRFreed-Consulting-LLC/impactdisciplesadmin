import { Timestamp } from 'firebase/firestore';
import { BaseModel } from '../base.model';
import { toMillis } from '../../utils/date-from-timestamp';

// A marketing campaign (Campaigns Manager, added 2026-08). One model for
// all 3 campaign goals - `type` decides which of the optional field groups
// below is actually in play; the Composer only ever shows/writes the group
// matching the type. See the Campaigns Manager section the feature was
// designed against (feature/campaign-manager branch) for the screen set.
// 'auto' (2026-08-18): tag-triggered automated sends - "everyone tagged
// Impact 1 gets this email N days after the purchase/registration that
// tagged them". Targets customers.tags (see TagRuleModel); the hourly
// autoCampaignScheduler Cloud Function does the sending while the campaign
// is effectively live. Distinct from the newsletter/prayer blasts and
// their no-audience-narrowing rule - this is a new send type, not a
// narrowing of those.
// 'email' (2026-08-18): a one-shot sent email - the ONLY kind of campaign
// Mailchimp has, so the whole imported archive (see
// scripts/import-mailchimp-campaigns.js) lands as this type, and future
// in-app one-time sends can share it. The email body html lives in the
// separate `campaign_emails` collection (same doc id), NOT here - 477
// imported docs x ~25KB of html would bloat every list page.
export type CampaignType = 'product' | 'event' | 'lead-capture' | 'auto' | 'email';

// The types the working screens (Campaigns list, Status Board) show -
// everything except 'email' history, which has its own Sent Emails screen.
export const ACTIVE_CAMPAIGN_TYPES: CampaignType[] = ['product', 'event', 'lead-capture', 'auto'];

// `status` is what's STORED; display always goes through effectiveStatus()
// below, which auto-promotes scheduled->live and live->ended as the dates
// pass without needing a writer to flip the field at the right moment.
export type CampaignStatus = 'draft' | 'scheduled' | 'live' | 'ended';

// Denormalized outcome counters, stamped onto the campaign doc so list/
// board/hub screens never fan out per-campaign queries. v1 initializes
// these to 0 and displays them; the Cloud Function wiring that increments
// them (coupon redemptions, event registrations, lead captures) is the
// build-order step after the admin screens - see the branch's plan.
export interface CampaignStats {
  emailsSent: number;
  linkClicks: number;
  leads: number;
  redemptions: number;
  registrations: number;
  revenue: number;
  // Email-campaign engagement (imported from Mailchimp's report_summary;
  // recipient_count lands in emailsSent, clicks in linkClicks). Optional -
  // absent on the goal-campaign types. Rates are derived at display time
  // (uniqueOpens / emailsSent), never stored.
  opens?: number;
  uniqueOpens?: number;
}

export const emptyCampaignStats = (): CampaignStats => ({
  emailsSent: 0,
  linkClicks: 0,
  leads: 0,
  redemptions: 0,
  registrations: 0,
  revenue: 0
});

export class CampaignModel extends BaseModel {
  name = '';
  type: CampaignType = 'product';
  status: CampaignStatus = 'draft';
  // Same shape union as EventModel's dates - existing docs in this app have
  // all 3 shapes, so reads always normalize via toMillis()/dateFromTimestamp()
  // (see MIGRATION.md). New writes from the Composer store real Dates.
  startDate?: Timestamp | Date | string | null;
  endDate?: Timestamp | Date | string | null;

  // -- product push --
  productId?: string | null;
  // -- event push --
  eventId?: string | null;
  // -- product/event push share these --
  subject?: string | null;
  message?: string | null;
  emailTemplateId?: string | null;
  // -- auto (tag-triggered automated send; also uses subject/message/
  //    emailTemplateId above for the email content) --
  // Customers holding ANY of these tags qualify.
  targetTags?: string[] | null;
  // Days after the tag's anchorDate (the triggering purchase/registration)
  // before the send fires; 0 = on the next scheduler run after tagging.
  sendAfterDays?: number | null;

  // -- lead capture --
  headline?: string | null;
  supportingText?: string | null;
  thankYouMessage?: string | null;
  // Public-site path the capture block renders at (e.g. '/welcome') -
  // consumed by impactdisciples-web once the landing block exists there.
  placement?: string | null;

  // Existing Coupons record (store-manager) - the discount system is NOT
  // duplicated here. Optional for product/event pushes, required by the
  // Composer for lead-capture (it's the incentive).
  couponId?: string | null;

  // Which gallery recipe this started from - informational only (shown as
  // "Started from X" in the Composer), never a live link back. Imported
  // 'email' campaigns reuse it for the Mailchimp template name they were
  // built from.
  templateName?: string | null;

  // -- 'email' campaigns imported from Mailchimp --
  // Where this record came from; null/absent = created in this app.
  source?: 'mailchimp' | null;
  // Mailchimp's own campaign id (doc id is `mc_<this>` - deterministic so
  // the import script is idempotent).
  mailchimpCampaignId?: string | null;

  stats: CampaignStats = emptyCampaignStats();
}

// Stored status + dates -> the status a human would say. Rules:
// - 'ended' stored, or any end date in the past -> ended (no writer has to
//   race the clock to flip live campaigns off)
// - 'scheduled' whose start date has arrived -> live
// - otherwise the stored value stands.
export const effectiveStatus = (c: CampaignModel): CampaignStatus => {
  const now = Date.now();
  const start = c.startDate ? toMillis(c.startDate) : 0;
  const end = c.endDate ? toMillis(c.endDate) : 0;

  if (c.status === 'ended' || (end > 0 && end < now && c.status !== 'draft')) {
    return 'ended';
  }
  if (c.status === 'scheduled' && start > 0 && start <= now) {
    return 'live';
  }
  return c.status;
};

export const CAMPAIGN_TYPE_LABELS: Record<CampaignType, string> = {
  'product': 'PRODUCT',
  'event': 'EVENT',
  'lead-capture': 'LEAD',
  'auto': 'AUTO',
  'email': 'EMAIL'
};
