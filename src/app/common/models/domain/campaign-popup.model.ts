import { Timestamp } from 'firebase/firestore';
import { BaseModel } from '../base.model';

// A campaign's web-channel popup (Campaign Manager v2, Phase 5) - one per
// campaign, doc id == campaignId, in its own PUBLIC-READABLE collection
// (`campaign_popups`) so the storefront can render it for anonymous
// visitors while campaign docs stay staff-only. NEVER put audience or
// stats on this doc - it is world-readable by design. Shown/clicked
// counters live on the campaign's own stats (webShown/webClicks),
// incremented by the campaign_web_event beacon. Replaces the dead
// home_page_popups feature (its admin screen wrote docs the public site
// never rendered - retired in Phase 6).
export class CampaignPopupModel extends BaseModel {
  campaignId = '';
  isActive = false;
  fromDate?: Timestamp | Date | string | null;
  toDate?: Timestamp | Date | string | null;
  title = '';
  // Raw HTML body (recipe-built or custom).
  html = '';
  width?: number | null;
  height?: number | null;
  bgColor?: string | null;
  // Where clicking the popup goes - stored ALREADY decorated with
  // ?cid=<campaignId>&csrc=popup (the editor appends it on save) so the
  // landing page's AttributionService picks it up.
  ctaUrl?: string | null;
  recipeName?: string | null;
}

// A reusable popup recipe (`popup_templates`, staff-only) - the popup
// equivalent of mail_templates. Grows via the editor's "save as
// template?" checkbox; seeded from the v1 campaign gallery's copy
// (scripts/seed-popup-templates.js).
export class PopupTemplateModel extends BaseModel {
  name = '';
  title = '';
  html = '';
  width?: number | null;
  height?: number | null;
  bgColor?: string | null;
}
