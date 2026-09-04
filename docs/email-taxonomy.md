# Email taxonomy (agreed vocabulary, 2026-08-18)

> Split out of the admin repo's CLAUDE.md on 2026-08-26 to keep the
> always-loaded file small. Read this before naming anything in the email/campaign domain.

### Email taxonomy (agreed vocabulary, 2026-08-18)

Every email in the system is one of two kinds, sorted by who presses send:

- **Transactional** — sent automatically by the platform because a customer did something: sales
  receipts, per-product follow-up emails, event-registration confirmations, reader receipts,
  password resets. All functions-side (`transactional-emails.ts`, `event-registration.functions.ts`).
  Admins edit their *content* (several render from `mail_templates` docs — the sales receipt is
  looked up **by the literal name "Sales Receipt"**, the Amazon fulfillment confirmation **by the
  literal name "Amazon Shipping Confirmation"** (PurchasesService.sendAmazonConfirmation), and
  product follow-ups by doc id via `Product.followUpEmailId` — so renaming/deleting those templates
  silently breaks the emails; a known, accepted risk for now, deliberately left unguarded per the
  user 2026-08-18), but never choose their audience or timing.
- **Campaigns** — admin-initiated outreach to contacts: the Campaigns Manager group (one-time and
  automated campaigns, tag rules, Mailchimp audience sync) plus the contextual sends that stay
  where their context is (newsletter/prayer blasts on the Subscribers report, attendee emails on an
  event's Attendees tab). All share the `mail_templates` catalogue + merge-tag engine.

The old web-form→admin notification emails (Lunch and Learn etc.) are a dead category — form
submissions today only feed the bell-badge counters (`new-record-alerts.functions.ts`) and the Form
Submissions screen; the only surviving form-related email is the admin-initiated Route Request
forward. Use this vocabulary in UI copy and code comments rather than inventing new terms.

**Templates vs. history** (2026-08-18): `mail_templates` holds only true, reusable TEMPLATES; what
actually went out is campaign history (below). The designer picker's collapsed **Past Emails**
section and the designer's `?fromEmail=<campaignEmailId>` seed let any past send start a new design.

**Campaign Manager v2** (2026-08-18, Phase 1 built on `feature/campaign-manager-v2` — full design
in the "Campaign Manager v2" plan): a campaign is a promotional EFFORT, not an email.
`CampaignModel` = `goal` ('product'|'event'|'other' + `otherKind`) + `channels` (['email','web']) +
`audience` + rollup `stats` (v2 funnel shape: sent/delivered/opens/uniqueOpens/clicks/uniqueClicks/
purchases/revenue/registrations/subscribes + webShown/webClicks) — the v1 `type` field and the
composer/template-gallery components are GONE (campaign creation returns with the Phase 2 wizard +
send engine; v1's Launch never sent anything anyway). `campaign_emails` docs are email "touches", N
per campaign via `campaignId` (no longer 1:1 same-doc-id), each with label/subject/html snapshot/
sentAt/per-email stats/sendConfig; composite index `campaign_emails(campaignId, sentAt DESC)` backs
the detail timeline. The 477 imported Mailchimp sends were REGROUPED into 78 campaigns (Blog Posts
149 emails, DMP Program 50, Disciple-Making Minute 43, Monthly Newsletter 40, Prayer Letter 30,
Podcast 23, summits by year, per-product/event pushes, singletons) via
`propose-campaign-regroup.js` (removed 2026-08-21; in git history) (auto-proposal, user-reviewed) +
`apply-campaign-regroup.js` (removed 2026-08-21; in git history) (idempotent, exports a full JSON backup to scripts/output/
first — the undo path). Surfaces: Campaigns list (all campaigns, kind/channel chips, funnel
columns) → in-page **campaign-detail** (funnel tiles + touches timeline, `?campaignId=` deep link),
Status Board (board+calendar lenses, cards deep-link to detail), **Sent Emails** = the global email
log over `campaign_emails`.

**Phase 2 (send engine, 2026-08-18)**: every campaign email sends through ONE server-side path,
`functions/src/campaign-send.functions.ts` — callables `enqueueCampaignEmail` /
`previewCampaignAudience` (same audience resolver as send-time, so previews can't lie) /
`sendCampaignTestEmail`, plus `campaignSendScheduler` every 10 minutes (drains queued sends
under the rolling-hour throttle below,
activates scheduled touches, runs tag-triggered automations — the old auto-campaign behavior is
now a touch's `sendConfig.mode: 'tagTriggered'`; `campaign-auto-send.functions.ts` is deleted).
Per-recipient ledger `campaign_sends/{emailDocId}__{email}` (atomic create = at-most-once per
touch; carries a crypto `token` for Phase 3 tracking + `unsubType`); `queueMail()` takes optional
`campaignMeta` and `onCampaignMailDelivered` (onDocumentUpdated mail/{id}) writes the Trigger
Email extension's SUCCESS state back as delivered counts. Every campaign send gets an unsubscribe
link (template's `*|UNSUB|*` or an appended fallback footer — never doubled). SMTP relay is the
org's OWN server (`mail.impactdisciples.com:26`, verified). **Throttle (rewritten 2026-09-04, when
the host confirmed the cap at 2,000/hour):** the old `MAX_SENDS_PER_RUN = 200` was a per-run
budget on one code path, NOT a throttle — the +25 immediate drain on every "Send now", test
sends, and every transactional and admin-composed email reached the same relay uncounted, so the
real rate was "200 plus whatever else happened" and was safe only by sitting far under the cap.
The budget is now MEASURED: `mailQueuedLastHour()` counts the `mail` collection itself over a
rolling 60 minutes (a `count()` aggregation; `date` needs no composite index), so every send path
consumes budget automatically and a new one cannot escape it. 200/hour is reserved for
transactional mail, leaving campaigns 1,800 — spread over six ticks of ~300 rather than one burst,
because ~2,000 serial sends would exceed the function timeout, strand ledger docs in `pending` for
`PENDING_RETRY_AGE_MS`, and push the two denormalized stats counters past Firestore's ~1 write/sec
per-document guidance. The drain loop is time-boxed for the same reason. `campaignSendBudget()` is
a pure export, unit-tested in `functions/test/campaign-pure.test.js`. A full-list blast (~2,400)
now rolls out in ~1.5 hours rather than ~12. UI: campaign-wizard (goal/audience/window; web channel
visible but disabled until Phase 5) + email-touch-editor (template-snapshot content — editing a
template later never rewrites campaign history; send now / schedule / tag-trigger; send-test).
Composite indexes `campaign_sends(status, createdAt)` + `campaign_sends(emailId, status)`.

**Phase 3 (tracking, 2026-08-18)**: `functions/src/campaign-tracking.functions.ts` — `campaign_open`
(1x1 GIF pixel, `?t=<token>`; opens++ always, uniqueOpens gated by the ledger's `openedAt`) and
`campaign_click` (`?t=&l=`; LINK-MAP redirect — the target comes from the touch's stored
`links {l1: url}`, never the query string, so there is no open-redirect surface; clicks/uniqueClicks,
and a click backfills the unique open for image-blocked clients). The send path builds the link map
lazily at first send (`ensureLinkMap`, covers all three modes), rewrites hrefs per recipient, and
injects the pixel; public-site links get `?cid=<campaignId>&ceid=<emailId>` appended in the map —
Phase 4's attribution capture reads those on landing. Unsubscribe links are NEVER routed through
tracking. Every hit also lands in `campaign_events` (staff-read/write-false). Opens are approximate
(proxy prefetch) — clicks/purchases are the trustworthy stages.
**Phase 4 (attribution, 2026-08-19)**: the funnel's conversion stages are wired end to end.
Web repo (`feature/campaign-attribution`, stacked on feature/paypal-speed): `AttributionService`
(src/app/shared/utils/services/) reads `?cid/&ceid/&csrc` from `window.location.search` in its
constructor — injected by AppComponent at bootstrap, deliberately BEFORE the router's first
navigation (pages rewrite query params on landing) — localStorage, 30-day TTL, last touch wins;
checkout/subscribe/event-registration requests attach it. Admin functions:
`sanitizeAttribution()` / `recordCampaignConversion()` / `campaignForCoupon()` in
campaign-tracking.functions.ts — `create_paypal_order` stamps validated attribution onto the
checkout form (free path credits immediately; paid path stages it on pending_orders and
`capture_paypal_order` credits on capture), `subscribe_to_email_list` credits fresh subscribes,
`register_for_event` credits registrations. Coupon fallback: no explicit attribution but a coupon
matching a LIVE campaign's `couponId` credits `via:'coupon'`. All best-effort — attribution can
never fail an order — and the campaign must exist before anything is credited (client field is
advisory). Purchases carry an `attribution` field now.
**Phase 5 (web popups, 2026-08-19)**: the second channel. `campaign_popups/{campaignId}` (one per
campaign, PUBLIC-readable rules — which is why popups are their own collection; never put audience
or stats on them) + staff-only `popup_templates` recipes (seeded by `scripts/seed-popup-templates.js`
from the retired v1 gallery copy). Admin: popup-editor (recipes, live preview, "save as template?",
date window, click-through URL auto-decorated with `?cid&csrc=popup`) reached from campaign detail's
Add/Edit Popup; saving an active popup adds 'web' to the campaign's channels. Web repo:
`campaign-popup.component` in the app shell shows the first active in-window popup to EVERY visitor
(no targeting, user decision) until they check don't-show-again (per-popup localStorage); fires the
CORS-open `campaign_web_event` beacon (web_shown once per visitor per popup — localStorage-guarded —
and web_click), which validates the campaign is effectively live before counting. A popup click
lands with `?cid&csrc=popup` → AttributionService → purchases credit `via:'popup'`.

**Phase 6 (consolidation, 2026-08-19)**: one send system. The Subscriber Report's newsletter/prayer
dialog and the event Attendees email dialog are now THIN FLOWS over the send engine — each send
creates a campaign (+one touch) and calls `enqueueCampaignEmail`, with a real audience-count
confirm first; the un-awaited client-side per-recipient loops and the write-only
`newsletters`/`prayers`/`customer-emails` archive collections are dead (frozen — the campaign IS
the archive; the public Monthly Newsletter page used to read the UNRELATED `monthly-newsletter`
collection — retired 2026-08-20, see "Public newsletter archive" below). Event-attendee sends use audience `unsubType: 'none'` — OPERATIONAL emails:
no unsubscribe footer and the newsletter opt-out is deliberately not applied (a marketing
unsubscribe must not withhold info about an event someone registered for). The Home Page Popups
screen (web-manager) is retired — the public site never had a renderer for it; its
`home_page_popups` docs are left inert. Phase 7 (Mailchimp sunset) executed 2026-08-20: newsletter
archive off Mailchimp links, images re-hosted, audience reconciled into `customers`, sync removed —
see the three paragraphs below; what's left is closing the account + deleting the
`MAILCHIMP_API_KEY` secrets once the one-time scripts are archived.

**Public newsletter archive (2026-08-20, `feature/newsletter-archive` in admin + web)**: the web
app's Monthly Newsletter page now lists/renders `campaign_emails` touches an admin flagged
`publishToWeb` (+ optional `webTitle`), through ONE public endpoint,
`functions/src/newsletter-archive.functions.ts` → `newsletter_archive` (no `?id` = JSON list of
`{id,title,date}`; `?id=` = the touch's html, merge tags rendered anonymously, Mailchimp-only
`*|...|*` tags stripped, scripts/on* removed, CSP `script-src 'none'`, CORS-open; composite index
`campaign_emails(publishToWeb, sentAt DESC)`). `campaign_emails` itself stays staff-only. The flag
is CURATED PER TOUCH on purpose — the old public list (14 rows, all mailchi.mp links) spanned the
regrouped Monthly Newsletter campaign, the Prayer Letter campaign AND standalone sends, and the
Monthly Newsletter campaign holds promos nobody published; "all touches of campaign X" was never
the rule. Set it from campaign detail's touch row (globe icon → "Show on website" dialog; sent/
sending touches only) or the Subscriber Report send dialog's checkbox. Retired: the Content
Manager's Monthly Newsletters screen/service/model and the `monthly-newsletter` collection + its
rules block (web repo: `NewsletterArchiveService` + `/monthly-newsletter/:id` sandboxed-srcdoc
viewer replace the Firestore read). `backfill-newsletter-archive.js` (removed 2026-08-21; in git history) maps legacy rows to
`mc_*` touches via the Mailchimp API's archive_url (dry-run default, `--execute`) — MIGRATION.md
has the prod runbook. Phase 7 note: the archived snapshots' images still live on Mailchimp's CDN
(`mcusercontent.com`); the sunset must keep the account alive or re-host them. **Website
Newsletters** tab (campaigns-manager, `web-newsletters/`): every flagged touch across ALL campaigns
= what the public page shows (live stream, preview / view-on-site / view-campaign / re-title-or-
unpublish) — needed because the published set is spread over several campaigns, so no one campaign
detail page answers "what's on the website?".

**Campaign delete (2026-08-20)**: the `deleteCampaign` callable
(`functions/src/campaign-admin.functions.ts`; `CampaignService.planDelete()` = its dryRun,
`deleteCascade()` = execute). Cascades every `campaign_emails` touch (incl. website-published ones)
and the `campaign_popups/{id}` doc, then the campaign — then (user requirement) deletes from Storage
every image those docs referenced that NOTHING else still references: every content-bearing
collection in the default DB is scanned once (`SCAN_DENYLIST` skips the big no-image ones; unknown
collections are scanned by default), so shared assets (re-hosted Mailchimp images used by many
emails, product photos reused in a promo) survive by construction. NOT removed:
`campaign_sends`/`campaign_events` (function-owned audit; the send engine tolerates a missing touch)
and `tag_applications` (customer facts). REFUSED while any touch is sending/scheduled. Caveat
inherent to "delete unused images": already-delivered copies of that campaign's emails lose those
images. Surfaces: list row trash icon and the detail header DELETE button, both behind
`canDelete('campaigns-manager.campaigns')`; confirm copy + result snackbar in
`campaigns/campaign-delete-text.ts` (shows the image-candidate count / unused-removed count).

**Mailchimp image re-host (2026-08-20, Phase 7 step)**: `rehost-mailchimp-images.js` (removed 2026-08-21; in git history) moved
every Mailchimp-CDN image referenced by `campaign_emails` + `mail_templates` (623 distinct files)
to `email-assets/mailchimp/<sha1>.<ext>` in the shared bucket and rewrote the docs in dev AND prod
(map in `scripts/output/rehost-map.json`, gitignored). Zero Mailchimp-host references remain in
either env — the public archive and Past Emails previews no longer depend on the Mailchimp account.
(A handful of snapshots also embed images from an unrelated external bucket,
`sawa-dev-2-storage-bucket.storage.googleapis.com` — not Mailchimp, left alone.)
