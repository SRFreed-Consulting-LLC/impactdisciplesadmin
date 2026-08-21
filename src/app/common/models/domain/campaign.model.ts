import { Timestamp } from 'firebase/firestore';
import { BaseModel } from '@impact-common/shared/models/base.model';
import { toMillis } from '../../utils/date-from-timestamp';

// Campaign Manager v2 (2026-08-18, designed with the user - see the
// "Campaign Manager v2" plan): a campaign is a promotional EFFORT, not an
// email. One doc records what was promoted (a store product, an event, or
// something looser - a prayer letter, a newsletter, a subscriber-growth
// offer), through which channel(s), to whom, and what happened. The
// individual emails that went out for a campaign are N `campaign_emails`
// "touches" (CampaignEmailModel) pointing back via campaignId; a web
// popup, when the campaign has one, is a `campaign_popups/{campaignId}`
// doc (public-readable - popups must never carry audience or stats).
//
// v1's `type` field ('product'|'event'|'lead-capture'|'auto'|'email') is
// GONE - goal + channels replace it. The 'auto' behavior (send N days
// after a tagging purchase/registration) lives on as a touch's
// sendConfig.mode 'tagTriggered'; the 477 imported Mailchimp sends were
// regrouped from 1:1 type-'email' campaigns into proper multi-email
// campaigns by scripts/apply-campaign-regroup.js.
export type CampaignGoal = 'product' | 'event' | 'other';

// Finer flavor when goal is 'other' - drives display grouping only, no
// behavior hangs off it.
export type CampaignOtherKind = 'prayer-letter' | 'newsletter' | 'subscriber-growth' | 'general';

// 'email'/'web' are the app-run channels (send engine / popup renderer).
// The three social channels are ASSISTED-MANUAL (2026-08-20): the social
// composer produces the artwork + captions and an admin posts by hand,
// then marks the channel posted. The data shape is deliberately API-ready
// for a future auto-publish phase - but API tokens will NEVER live
// client-side (Web Config is world-readable by rule; see
// WebConfigModel's own comment).
export type CampaignChannel = 'email' | 'web' | 'facebook' | 'twitter' | 'instagram';

export type SocialChannel = 'facebook' | 'twitter' | 'instagram';

// The campaign's assisted-manual social block (see CampaignChannel's
// comment). One shared caption + hashtags, optional per-channel caption
// overrides (null = "use the shared caption"), and per-channel posted
// stamps - Firestore Timestamps once an admin marks the channel posted
// (typed unknown because stored date fields in this app arrive in three
// shapes - see MIGRATION.md - and reads normalize via dateFromTimestamp).
export interface CampaignSocial {
  caption?: string;
  hashtags?: string;
  overrides?: {
    facebook?: string | null;
    twitter?: string | null;
    instagram?: string | null;
  };
  posted?: {
    facebook?: unknown;
    twitter?: unknown;
    instagram?: unknown;
  };
}

// `status` is what's STORED; display always goes through effectiveStatus()
// below, which auto-promotes scheduled->live and live->ended as the dates
// pass without needing a writer to flip the field at the right moment.
export type CampaignStatus = 'draft' | 'scheduled' | 'live' | 'ended';

// Who an EMAIL touch goes to (web popups have no audience - they show to
// every site visitor, a user-confirmed decision). Resolved server-side at
// send time by the send engine; previewCampaignAudience uses the same
// resolver so the preview can't lie.
export interface CampaignAudience {
  mode: 'everyone' | 'flags' | 'tags' | 'list';
  // 'flags': customers where any of these booleans is true.
  flags?: ('subscribedToNewsletter' | 'subscribedToPrayerTeam')[];
  // 'tags': customers.tags array-contains-any of these.
  tags?: string[];
  // 'list': explicit recipient emails.
  emails?: string[];
  // Explicit unsubscribe-list override. 'none' marks an OPERATIONAL send
  // (event-attendee info emails): no unsubscribe footer and no
  // newsletter-opt-out skip - someone who unsubscribed from marketing
  // still gets info about the event they registered for.
  unsubType?: 'newsletter' | 'prayer' | 'none';
}

// Per-email-touch funnel counters, and the building block of the campaign
// rollup. Everything denormalized so list/detail screens never fan out
// per-campaign queries; rates (open %, click %) are ALWAYS derived at
// display time, never stored. Imported Mailchimp numbers map:
// emailsSent -> sent, opens/uniqueOpens as-is, linkClicks -> clicks;
// delivered/purchases/etc start at 0 (our own tracking fills them for new
// sends - Phases 2-4).
export interface EmailStats {
  sent: number;
  delivered: number;
  opens: number;
  uniqueOpens: number;
  clicks: number;
  uniqueClicks: number;
  purchases: number;
  revenue: number;
  registrations: number;
  subscribes: number;
}

// Campaign-level rollup = EmailStats totals across touches + the web
// channel's counters.
export interface CampaignStats extends EmailStats {
  webShown: number;
  webClicks: number;
}

export const emptyEmailStats = (): EmailStats => ({
  sent: 0,
  delivered: 0,
  opens: 0,
  uniqueOpens: 0,
  clicks: 0,
  uniqueClicks: 0,
  purchases: 0,
  revenue: 0,
  registrations: 0,
  subscribes: 0
});

export const emptyCampaignStats = (): CampaignStats => ({
  ...emptyEmailStats(),
  webShown: 0,
  webClicks: 0
});

export class CampaignModel extends BaseModel {
  name = '';
  goal: CampaignGoal = 'other';
  otherKind?: CampaignOtherKind | null;
  // -- goal targets --
  productId?: string | null;
  eventId?: string | null;

  channels: CampaignChannel[] = ['email'];
  status: CampaignStatus = 'draft';
  // Same shape union as EventModel's dates - existing docs in this app have
  // all 3 shapes, so reads always normalize via toMillis()/dateFromTimestamp()
  // (see MIGRATION.md). A null endDate means a LONG-RUNNING series (e.g. the
  // Prayer Letter campaign) that future touches keep attaching to.
  startDate?: Timestamp | Date | string | null;
  endDate?: Timestamp | Date | string | null;

  // Email-channel audience (see CampaignAudience). Absent on web-only
  // campaigns and on regrouped history (whose audience is unknowable).
  audience?: CampaignAudience | null;

  // Existing Coupons record (store-manager) - the discount system is NOT
  // duplicated here. Doubles as the secondary purchase-attribution signal:
  // a purchase carrying this coupon code with no explicit ?cid= attribution
  // still credits this campaign (via:'coupon').
  couponId?: string | null;

  // Where this record came from; null/absent = created in this app.
  source?: 'mailchimp' | null;

  stats: CampaignStats = emptyCampaignStats();

  // Assisted-manual social publishing (see CampaignSocial). Null/absent =
  // the composer has never saved for this campaign.
  social?: CampaignSocial | null;

  // Distinguishes migrated v2 docs from any stray v1 shape; fromFirestore
  // normalizers key off it.
  schemaVersion?: number;
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

export const CAMPAIGN_GOAL_LABELS: Record<CampaignGoal, string> = {
  'product': 'PRODUCT',
  'event': 'EVENT',
  'other': 'OTHER'
};

export const CAMPAIGN_OTHER_KIND_LABELS: Record<CampaignOtherKind, string> = {
  'prayer-letter': 'PRAYER LETTER',
  'newsletter': 'NEWSLETTER',
  'subscriber-growth': 'SUBSCRIBER GROWTH',
  'general': 'GENERAL'
};

// Channel chip/column labels - 'twitter' displays as X (the platform
// renamed; the stored value stays 'twitter' so existing docs and the
// ?csrc attribution vocabulary never fork).
export const CAMPAIGN_CHANNEL_LABELS: Record<CampaignChannel, string> = {
  'email': 'EMAIL',
  'web': 'WEB',
  'facebook': 'FACEBOOK',
  'twitter': 'X',
  'instagram': 'INSTAGRAM'
};

export const channelLabel = (channel: CampaignChannel): string =>
  CAMPAIGN_CHANNEL_LABELS[channel] ?? String(channel).toUpperCase();

// The label a list row / chip shows - the otherKind flavor when present,
// else the goal.
export const campaignKindLabel = (c: CampaignModel): string => {
  if (c.goal === 'other' && c.otherKind) {
    return CAMPAIGN_OTHER_KIND_LABELS[c.otherKind];
  }
  return CAMPAIGN_GOAL_LABELS[c.goal] ?? 'OTHER';
};
