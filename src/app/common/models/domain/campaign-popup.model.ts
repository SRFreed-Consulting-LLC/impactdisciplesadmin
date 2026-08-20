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
// Structured Call To Action (2026-08-20, user feature). Three shapes:
//  - 'close': pure announcement - one button that dismisses.
//  - 'link':  primary button navigates (target derived from the campaign's
//             own goal on save - event registration page / product page -
//             already ?cid-decorated like the legacy ctaUrl), plus a
//             secondary dismiss.
//  - 'form':  the popup COLLECTS data - admin-chosen fields (email always)
//             submitted to either the newsletter list (subscribe endpoint,
//             credits the campaign's subscribes) or Form Submissions
//             (anonymous form_submissions create, rules-shape-compliant).
// Mirror any change into the web repo's CampaignPopup interface
// (campaign-popup.service.ts) - independent copies, hand-synced.
export type PopupCtaField = 'email' | 'firstName' | 'lastName' | 'phone';
export interface PopupCta {
  type: 'close' | 'link' | 'form';
  primaryLabel: string;
  dismissLabel?: string | null;
  linkUrl?: string | null;
  formFields?: PopupCtaField[] | null;
  formDestination?: 'newsletter' | 'formSubmissions' | null;
}

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
  // LEGACY whole-popup click-through - superseded by `cta` (kept written in
  // link mode for old web bundles; the renderer prefers `cta` when
  // present). Stored ALREADY decorated with ?cid=<campaignId>&csrc=popup.
  ctaUrl?: string | null;
  cta?: PopupCta | null;
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
