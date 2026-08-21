import { Timestamp } from 'firebase/firestore';
import { BaseModel } from '@impact-common/shared/models/base.model';
import { CampaignAudience, EmailStats, emptyEmailStats } from './campaign.model';

// One email "touch" of a campaign (Campaign Manager v2): a single email
// that went (or will go) out for a CampaignModel, N per campaign via
// campaignId. Imported Mailchimp sends keep their `mc_<id>` doc ids; new
// touches get auto ids. The ~25KB html snapshot lives here - NEVER on the
// campaign doc - so campaign list pages stay light; fetch on demand only
// (detail timeline, preview, the designer picker's Past Emails cards,
// ?fromEmail= seeding).
export type CampaignEmailStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'canceled';

// How/when this touch sends (Phase 2's send engine consumes this):
// - 'now': enqueued immediately on demand.
// - 'scheduled': the scheduler enqueues it when scheduledAt arrives.
// - 'tagTriggered': the old 'auto' campaign behavior - each customer gets
//   it afterDays days after the tag_applications anchorDate that gave them
//   any of these tags (per-recipient clock, drained continuously while the
//   campaign is live).
export interface CampaignEmailSendConfig {
  mode: 'now' | 'scheduled' | 'tagTriggered';
  scheduledAt?: Timestamp | Date | string | null;
  tagTrigger?: { tags: string[]; afterDays: number } | null;
}

export class CampaignEmailModel extends BaseModel {
  campaignId = '';
  // Optional human label for the timeline ("March issue", "Reminder #2").
  label?: string | null;
  subject = '';
  // The compiled, sendable/as-sent document snapshot (its own <html>/<head>/
  // <body> for imports; builder-compiled output for our own sends). Wrap
  // through createDesignFromFullHtml() before handing to the designer.
  html = '';
  // The email-designer JSON, kept ONLY while draft - stripped when the
  // touch sends (the html snapshot is the historical record; design JSON
  // can be large and has no post-send purpose).
  design?: object | null;
  // Link map built at prepare time by the send engine: linkId -> original
  // URL. Per-recipient rendering rewrites hrefs to the campaign_click
  // endpoint carrying (token, linkId) - no URL ever rides in a tracked
  // link (that shape would be an open redirect).
  links?: Record<string, string> | null;

  status: CampaignEmailStatus = 'draft';
  sendConfig?: CampaignEmailSendConfig | null;
  // Overrides the campaign's audience for just this touch when present.
  audienceOverride?: CampaignAudience | null;

  sentAt?: Timestamp | Date | string | null;
  recipientCount?: number | null;
  stats: EmailStats = emptyEmailStats();

  source?: 'mailchimp' | null;
  mailchimpCampaignId?: string | null;
  capturedAt?: Timestamp | Date | string | null;

  // Public newsletter archive (2026-08-20): when true, the web app's
  // Monthly Newsletter page lists this touch and renders its html via the
  // `newsletter_archive` function - the ONLY public read path onto this
  // collection. Curated per touch on purpose (campaign detail's "Show on
  // website" / the Subscriber Report send dialog's checkbox): the public
  // list was never "every newsletter-kind send". Replaced the admin's
  // hand-maintained `monthly-newsletter` collection of Mailchimp links.
  // Only meaningful on sent/sending touches; the endpoint re-checks.
  publishToWeb?: boolean;
  // Optional public display title (falls back to label, then subject).
  webTitle?: string | null;
}
