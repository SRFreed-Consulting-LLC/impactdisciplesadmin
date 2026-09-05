import {tenantPath} from "./common/shared/lists/tenancy";
const CUSTOMERS = tenantPath("customers");
const EMAILS = tenantPath("campaign_emails");
const SENDS = tenantPath("campaign_sends");
const CAMPAIGNS = tenantPath("campaigns");
const TAG_APPLICATIONS = tenantPath("tag_applications");
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import {Timestamp, FieldValue, getFirestore} from "firebase-admin/firestore";
import * as crypto from "crypto";
import {requireAdminRole} from "./admin-users.functions";
import {queueMail, UNSUBSCRIBE_URL} from "./transactional-emails";
import {TRACKING_BASE} from "./campaign-tracking.functions";
import {renderMergeTags} from "./utils/merge-tags.functions";
import {toMillis} from "./utils/date-normalize.functions";
import {
  EnqueueCampaignEmailRequest,
  EnqueueCampaignEmailResult,
  PreviewCampaignAudienceRequest,
  PreviewCampaignAudienceResult,
  SendCampaignTestEmailRequest,
  SendCampaignTestEmailResult,
} from "./common/shared/contract/admin-callables.types";

// Campaign Manager v2's UNIFIED SEND ENGINE (Phase 2 of the plan) - the
// one server-side path every campaign email goes through, whatever its
// trigger:
//   - 'now'          admin clicks Send -> enqueueCampaignEmail reserves a
//                    ledger doc per recipient and drains a first batch
//                    immediately,
//   - 'scheduled'    the hourly scheduler enqueues the touch when its
//                    scheduledAt arrives,
//   - 'tagTriggered' the old auto-campaign behavior: each customer gets
//                    the email N days after the tag_applications
//                    anchorDate that gave them the tag (drained
//                    continuously while the touch is active).
// Replaces campaign-auto-send.functions.ts (which was never deployed);
// its reserve-then-send failure model, stale-pending retry, and paced
// budget survive here.
//
// Ledger: campaign_sends/{emailDocId}__{recipientEmail} - the atomic
// create() IS the at-most-once lock, per TOUCH (a long-running campaign
// sends many emails to the same person; each touch reaches them once).
// Every ledger doc carries a crypto-random `token` - Phase 3's open-pixel
// and click-redirect endpoints resolve recipients by token so no email
// address ever rides in a tracked URL.
//
// PACING / THROTTLE (rewritten 2026-09-04, when the hosting provider
// confirmed the real ceiling).
//
// The Trigger Email extension relays through the org's OWN mail server
// (mail.impactdisciples.com:26), whose cap the provider has now confirmed at
// 2,000 messages per hour. Until then this file carried a flat
// MAX_SENDS_PER_RUN = 200 per hourly tick, chosen as a guess.
//
// THAT NUMBER WAS NEVER A THROTTLE, which is the thing to understand before
// changing it. It bounded one code path - the scheduler's drain - while
// three others reached the same relay uncounted:
//   - enqueueCampaignEmail drains IMMEDIATE_DRAIN_BUDGET more on every
//     "Send now", as many times an hour as an admin clicks;
//   - sendCampaignTestEmail queues outside any budget;
//   - every TRANSACTIONAL email (receipts, event confirmations, subscription
//     confirmations, library invites, lockout alerts) and every admin-
//     composed client-side send (Amazon shipping confirmations, route
//     requests) writes `mail` directly and was never counted at all.
// The real hourly rate was therefore "200 plus whatever else happened". That
// was safe only because 200 sat an order of magnitude under the true cap -
// raising the same constant to 2000 would have spent the entire margin on
// campaign mail and let the uncounted paths push the total over the cap.
//
// So the budget is now measured, not assumed: WHAT WE COUNT IS THE `mail`
// COLLECTION ITSELF (mailQueuedLastHour below), over a rolling 60 minutes.
// Every email of every kind lands there - that collection IS what the relay
// sees - so transactional mail, test sends and admin-composed sends all
// consume budget automatically, and no future send path can be added that
// quietly escapes the throttle. A rolling window is deliberately stricter
// than a clock-hour one: any clock hour is itself a 60-minute window, so
// holding every rolling window under the cap holds every clock hour under it
// too, whichever way the provider measures.
//
// TRANSACTIONAL_RESERVE is the slice campaigns may never eat into. A receipt
// is time-critical and a blast is not, so a customer who buys something
// during a 2,000-recipient send must not wait behind it.
//
// Shape: small runs, often. MAX_SENDS_PER_RUN caps ONE tick; the rolling
// count is what enforces the hour. Draining ~2,000 in a single hourly burst
// would blow the function timeout (sendLedgerDoc is serial, ~6 Firestore
// round trips each), leave hundreds of ledger docs stranded in 'pending'
// until PENDING_RETRY_AGE_MS, and hammer the two denormalized stats counters
// well past Firestore's ~1 write/sec per-document guidance. Six ticks an
// hour of ~300 stays inside every one of those limits and reaches the same
// 1,800/hour - and it makes scheduled touches punctual to 10 minutes rather
// than 60 as a side benefit.

/** The relay's confirmed ceiling (hosting provider, 2026-09-04). */
const SMTP_HOURLY_CAP = 2000;
/** Held back from campaign sends for transactional + ad-hoc staff mail. */
const TRANSACTIONAL_RESERVE = 200;
/** How often campaignSendScheduler ticks. Keep in step with the schedule
 *  string on the function itself - MAX_SENDS_PER_RUN is sized against it. */
const SCHEDULER_INTERVAL_MINUTES = 10;
/** Campaign mail permitted per hour, once the reserve is set aside. */
const CAMPAIGN_HOURLY_BUDGET = SMTP_HOURLY_CAP - TRANSACTIONAL_RESERVE;
/** Ceiling for ONE tick - an even share of the hour across the ticks in it.
 *  DERIVED rather than typed so the two cannot drift: halving the interval
 *  without halving this would double the burst each run makes, and the
 *  rolling counter would absorb it silently by simply going idle for the
 *  rest of the hour, which is the lumpy shape this pacing exists to avoid.
 *  The rolling-hour budget remains the real limit; this only shapes it. */
const MAX_SENDS_PER_RUN = Math.ceil(
  CAMPAIGN_HOURLY_BUDGET / (60 / SCHEDULER_INTERVAL_MINUTES)
);
/** Wall-clock the drain loop may spend, leaving room inside timeoutSeconds
 *  to finish cleanly rather than being killed mid-send. */
const DRAIN_TIME_BUDGET_MS = 3.5 * 60 * 1000;
/** Budget assumed when the rolling count cannot be read (see
 *  mailQueuedLastHour) - conservative, and below the flat per-tick rate this
 *  engine already ran on safely. */
const DEGRADED_RUN_BUDGET = 100;
const HOUR_MS = 60 * 60 * 1000;

const IMMEDIATE_DRAIN_BUDGET = 25;
const PENDING_RETRY_AGE_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How many sends this run may make: whatever the rolling hour has left,
 * clamped to the per-run ceiling. Pure, so the arithmetic is unit-testable
 * without an emulator (functions/test/campaign-pure.test.js).
 * @param {number} queuedLastHour Mail docs created in the last 60 minutes.
 * @param {number} runCeiling Max this single run may send.
 * @return {number} Sends permitted now; 0 when the hour is spent.
 */
export function campaignSendBudget(
  queuedLastHour: number,
  runCeiling: number
): number {
  const remaining = CAMPAIGN_HOURLY_BUDGET - Math.max(0, queuedLastHour);
  return Math.max(0, Math.min(runCeiling, remaining));
}

/**
 * Counts every email queued in the last rolling hour.
 *
 * A count() aggregation, not a fetch - `mail` documents carry full message
 * bodies, and reading a thousand of them to learn a number would cost more
 * than the send. `date` is a single field, so Firestore's automatic index
 * covers this; no composite index is needed.
 *
 * Both writers stamp `date` at queue time (queueMail here, EMailService in
 * the Angular app), so this measures what we have HANDED to the relay rather
 * than what it has finished sending - the conservative side, and the only
 * side we control.
 *
 * Failure is swallowed on purpose: a throttle that cannot read its meter
 * must not stall every campaign in the system. The caller falls back to
 * DEGRADED_RUN_BUDGET and says so in the log.
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @return {Promise<number | null>} The count, or null when unreadable.
 */
async function mailQueuedLastHour(
  db: FirebaseFirestore.Firestore
): Promise<number | null> {
  try {
    const since = Timestamp.fromMillis(Date.now() - HOUR_MS);
    // A LITERAL, like the onCampaignMailDelivered trigger below and for the
    // same reason: `mail` belongs to the Trigger Email extension and is
    // pinned out of TENANT_COLLECTIONS, so it cannot move.
    const snap = await db.collection("mail")
      .where("date", ">=", since).count().get();
    return snap.data().count;
  } catch (err) {
    console.error(
      "Could not measure the last hour of mail - falling back to a reduced " +
      `budget of ${DEGRADED_RUN_BUDGET} sends for this run.`, err
    );
    return null;
  }
}

/**
 * The measured budget for one run, with the degraded fallback applied.
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @param {number} runCeiling Max this single run may send.
 * @return {Promise<number>} Sends permitted now.
 */
async function currentSendBudget(
  db: FirebaseFirestore.Firestore,
  runCeiling: number
): Promise<number> {
  const queued = await mailQueuedLastHour(db);
  if (queued === null) {
    return Math.min(runCeiling, DEGRADED_RUN_BUDGET);
  }
  return campaignSendBudget(queued, runCeiling);
}

type AudienceSpec = {
  mode?: "everyone" | "flags" | "tags" | "list";
  flags?: string[];
  tags?: string[];
  emails?: string[];
  // Explicit override of the derived unsubscribe list. 'none' marks an
  // OPERATIONAL send (event-attendee info emails): no unsubscribe footer,
  // and the newsletter opt-out is NOT applied - someone who unsubscribed
  // from marketing must still get info about the event they registered
  // for (see event-email-dialog.component.ts's 2026-08-12 note).
  unsubType?: "newsletter" | "prayer" | "none";
};

interface CampaignDoc {
  id: string;
  name?: string;
  status?: string;
  startDate?: unknown;
  endDate?: unknown;
  audience?: AudienceSpec | null;
}

interface TouchDoc {
  id: string;
  campaignId?: string;
  label?: string | null;
  subject?: string;
  html?: string;
  status?: string;
  links?: Record<string, string> | null;
  sendConfig?: {
    mode?: "now" | "scheduled" | "tagTriggered";
    scheduledAt?: unknown;
    tagTrigger?: {tags?: string[]; afterDays?: number} | null;
  } | null;
  audienceOverride?: AudienceSpec | null;
}

// ---- Phase 3: link map + per-recipient tracking rewrite ----

/**
 * Extracts every http(s) href from a touch's html, in order, deduped by
 * raw attribute value. Deterministic on immutable touch html, so ids stay
 * stable across render calls.
 * @param {string} html The touch html (pre-merge-render).
 * @return {object[]} Link entries ({id, raw}).
 */
function extractLinks(html: string): Array<{id: string; raw: string}> {
  const seen = new Map<string, string>();
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const raw = match[1];
    if (!/^https?:\/\//i.test(raw) || seen.has(raw)) {
      continue;
    }
    seen.set(raw, `l${seen.size + 1}`);
  }
  return [...seen.entries()].map(([raw, id]) => ({id, raw}));
}

/**
 * The redirect target stored in the link map: the decoded original URL,
 * decorated with ?cid/&ceid when it points at the public site so Phase
 * 4's attribution capture can pick it up on landing.
 * @param {string} raw Raw href attribute value (may be &amp;-encoded).
 * @param {string} campaignId Campaign doc id.
 * @param {string} emailId Touch doc id.
 * @return {string} Final redirect target.
 */
function linkTarget(raw: string, campaignId: string, emailId: string): string {
  const url = raw.replace(/&amp;/g, "&");
  if (!/^https?:\/\/([a-z0-9-]+\.)*impactdisciples\.com(\/|$|\?)/i.test(url)) {
    return url;
  }
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}cid=${encodeURIComponent(campaignId)}` +
    `&ceid=${encodeURIComponent(emailId)}`;
}

/**
 * Ensures the touch has its link map stored (built once, first send wins;
 * lazily here so every mode - now/scheduled/tagTriggered - gets one).
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @param {TouchDoc} touch The touch (mutated with the map).
 * @return {Promise<void>} Resolves when the map exists.
 */
async function ensureLinkMap(
  db: FirebaseFirestore.Firestore,
  touch: TouchDoc
): Promise<void> {
  if (touch.links && Object.keys(touch.links).length > 0) {
    return;
  }
  const links: Record<string, string> = {};
  for (const {id, raw} of extractLinks(touch.html ?? "")) {
    links[id] = linkTarget(raw, touch.campaignId ?? "", touch.id);
  }
  touch.links = links;
  if (Object.keys(links).length > 0) {
    await db.collection(EMAILS).doc(touch.id)
      .update({links}).catch(() => undefined);
  }
}

/**
 * Per-recipient tracking pass over the RENDERED html: every mapped href
 * becomes a campaign_click redirect carrying (token, linkId), and the
 * open pixel lands before </body>. Merge rendering never touches http
 * hrefs (*|UNSUB|* is not http), so raw-string replacement is exact.
 * @param {string} renderedHtml Merge-rendered html.
 * @param {string} touchHtml The touch's stored html (for extraction).
 * @param {string} token This recipient's ledger token.
 * @return {string} Tracked html.
 */
function applyTracking(
  renderedHtml: string,
  touchHtml: string,
  token: string
): string {
  let html = renderedHtml;
  for (const {id, raw} of extractLinks(touchHtml)) {
    const tracked =
      `${TRACKING_BASE}/campaign_click?t=${token}&amp;l=${id}`;
    html = html.split(`href="${raw}"`).join(`href="${tracked}"`);
  }
  const pixel = `<img src="${TRACKING_BASE}/campaign_open?t=${token}" ` +
    "width=\"1\" height=\"1\" alt=\"\" style=\"display:none\">";
  return html.includes("</body>") ?
    html.replace("</body>", pixel + "</body>") :
    html + pixel;
}

/**
 * Mirror of the client's effectiveStatus() (campaign.model.ts) - statuses
 * auto-promote by date at read time.
 * @param {CampaignDoc} campaign The campaign doc.
 * @return {string} The effective status.
 */
export function effectiveCampaignStatus(campaign: CampaignDoc): string {
  const now = Date.now();
  const start = campaign.startDate ? toMillis(campaign.startDate) : 0;
  const end = campaign.endDate ? toMillis(campaign.endDate) : 0;
  if (campaign.status === "ended" ||
      (end > 0 && end < now && campaign.status !== "draft")) {
    return "ended";
  }
  if (campaign.status === "scheduled" && start > 0 && start <= now) {
    return "live";
  }
  return campaign.status ?? "draft";
}

/** @return {string} A 24-char URL-safe recipient token (Phase 3 tracking). */
function newToken(): string {
  return crypto.randomBytes(18).toString("base64url");
}

/**
 * Resolves an audience spec to unique, lowercased recipient emails - the
 * SAME resolver serves previews and sends, so the preview can't lie.
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @param {AudienceSpec} audience The spec.
 * @return {Promise<string[]>} Sorted unique emails.
 */
export async function resolveAudience(
  db: FirebaseFirestore.Firestore,
  audience: AudienceSpec
): Promise<string[]> {
  const emails = new Set<string>();
  const addDoc = (data: FirebaseFirestore.DocumentData) => {
    const email = (data.email ?? "").toString().trim().toLowerCase();
    if (email) {
      emails.add(email);
    }
  };

  if (audience.mode === "everyone") {
    (await db.collection(CUSTOMERS).get()).docs
      .forEach((d) => addDoc(d.data()));
  } else if (audience.mode === "flags") {
    const flags = (audience.flags ?? []).filter((f) =>
      f === "subscribedToNewsletter" || f === "subscribedToPrayerTeam");
    for (const flag of flags) {
      (await db.collection(CUSTOMERS).where(flag, "==", true).get())
        .docs.forEach((d) => addDoc(d.data()));
    }
  } else if (audience.mode === "tags") {
    const tags = (audience.tags ?? []).filter(Boolean);
    // array-contains-any accepts at most 10 values per query.
    for (let i = 0; i < tags.length; i += 10) {
      (await db.collection(CUSTOMERS)
        .where("tags", "array-contains-any", tags.slice(i, i + 10)).get())
        .docs.forEach((d) => addDoc(d.data()));
    }
  } else if (audience.mode === "list") {
    for (const raw of audience.emails ?? []) {
      const email = (raw ?? "").toString().trim().toLowerCase();
      if (email.includes("@")) {
        emails.add(email);
      }
    }
  } else {
    throw new HttpsError("invalid-argument", "audience.mode is required.");
  }
  return [...emails].sort();
}

/**
 * Which unsubscribe list a send belongs to: prayer-flag audiences opt out
 * of the prayer list, everything else the newsletter list (fixes the v1
 * blast dialog's newsletter-only hardcode for prayer sends).
 * @param {AudienceSpec} audience The audience.
 * @return {string} 'prayer' | 'newsletter'.
 */
function unsubTypeFor(audience: AudienceSpec): string {
  if (audience.unsubType) {
    return audience.unsubType;
  }
  const flags = audience.flags ?? [];
  return audience.mode === "flags" &&
    flags.includes("subscribedToPrayerTeam") &&
    !flags.includes("subscribedToNewsletter") ? "prayer" : "newsletter";
}

/**
 * Creates the per-recipient ledger reservations for a touch and flips it
 * to 'sending'. Shared by the Send-now callable and the scheduler's
 * scheduled-touch activation.
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @param {TouchDoc} touch The email touch.
 * @param {CampaignDoc} campaign Its campaign.
 * @return {Promise<object>} {recipients, queued} counts.
 */
async function enqueueTouch(
  db: FirebaseFirestore.Firestore,
  touch: TouchDoc,
  campaign: CampaignDoc
): Promise<{recipients: number; queued: number}> {
  const audience = touch.audienceOverride ?? campaign.audience;
  if (!audience?.mode) {
    throw new HttpsError("failed-precondition",
      "The campaign has no audience defined.");
  }
  if (!(touch.subject ?? "").trim() || !(touch.html ?? "").trim()) {
    throw new HttpsError("failed-precondition",
      "The email needs a subject and content before sending.");
  }
  const recipients = await resolveAudience(db, audience);
  if (recipients.length === 0) {
    throw new HttpsError("failed-precondition",
      "The audience resolves to zero recipients.");
  }

  const unsubType = unsubTypeFor(audience);
  let queued = 0;
  // BulkWriter parallelizes the creates; already-exists errors (rerun of a
  // partially-enqueued touch) are silently skipped so enqueue is idempotent.
  const writer = db.bulkWriter();
  writer.onWriteError((err) => {
    if (err.code === 6 /* ALREADY_EXISTS */) {
      return false;
    }
    return err.failedAttempts < 3;
  });
  for (const email of recipients) {
    writer.create(
      db.collection(SENDS).doc(`${touch.id}__${email}`),
      {
        campaignId: campaign.id,
        emailId: touch.id,
        email,
        status: "queued",
        token: newToken(),
        unsubType,
        createdAt: Timestamp.now(),
      }
    ).then(() => queued++).catch(() => undefined);
  }
  await writer.close();

  await db.collection(EMAILS).doc(touch.id).update({
    status: "sending",
    recipientCount: recipients.length,
  });
  // A sending campaign is live (drafts only; regrouped history that gets a
  // fresh touch keeps its own stored status).
  if (campaign.status === "draft") {
    await db.collection(CAMPAIGNS).doc(campaign.id).update({
      status: "live",
      startDate: Timestamp.now(),
    });
  }
  return {recipients: recipients.length, queued};
}

/**
 * Sends ONE reserved ledger doc: re-checks the recipient's unsubscribe
 * flag, renders the touch html with merge tags + unsubscribe URL, queues
 * the mail doc (carrying campaignMeta for the delivered-writeback
 * trigger), finalizes the ledger, bumps touch + campaign sent counters.
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @param {FirebaseFirestore.QueryDocumentSnapshot} ledgerDoc The ledger doc.
 * @param {Map<string, TouchDoc | null>} touchCache Per-run touch cache.
 * @return {Promise<void>} Resolves when the ledger doc is finalized.
 */
async function sendLedgerDoc(
  db: FirebaseFirestore.Firestore,
  ledgerDoc: FirebaseFirestore.QueryDocumentSnapshot,
  touchCache: Map<string, TouchDoc | null>
): Promise<void> {
  const ledger = ledgerDoc.data();
  const email = ledger.email as string;
  try {
    await ledgerDoc.ref.update({status: "pending"});

    let touch = touchCache.get(ledger.emailId);
    if (touch === undefined) {
      const snap = await db.collection(EMAILS)
        .doc(ledger.emailId).get();
      touch = snap.exists ? {id: snap.id, ...snap.data()} as TouchDoc : null;
      touchCache.set(ledger.emailId, touch);
    }
    if (!touch) {
      await ledgerDoc.ref.update(
        {status: "failed", error: "email touch deleted"});
      return;
    }

    const customerSnap = await db.collection(CUSTOMERS)
      .where("email", "==", email).limit(1).get();
    const customer = customerSnap.empty ? {} : customerSnap.docs[0].data();

    // Honor an unsubscribe that landed between enqueue and send -
    // except for operational sends (unsubType 'none'), which aren't
    // marketing and ignore the flags entirely.
    if (ledger.unsubType !== "none") {
      const unsubFlag = ledger.unsubType === "prayer" ?
        "subscribedToPrayerTeam" : "subscribedToNewsletter";
      if (customer[unsubFlag] === false) {
        await ledgerDoc.ref.update({
          status: "skipped",
          error: `customer unsubscribed (${ledger.unsubType})`,
          sentAt: Timestamp.now(),
        });
        return;
      }
    }

    const operational = ledger.unsubType === "none";
    const unsubscribeUrl = operational ? "" :
      `${UNSUBSCRIBE_URL}?email=${encodeURIComponent(email)}` +
      `&type=${ledger.unsubType ?? "newsletter"}`;
    const context = {
      firstName: customer.firstName ?? "",
      lastName: customer.lastName ?? "",
      email,
      date: new Date().toLocaleDateString("en-US"),
      unsubscribeUrl,
    };
    await ensureLinkMap(db, touch);
    let html = renderMergeTags(touch.html ?? "", context);
    // Phase 3: rewrite mapped links to the click redirect + inject the
    // open pixel, both keyed by this recipient's ledger token. The
    // unsubscribe link (merge-rendered / fallback below) stays DIRECT -
    // opting out must never depend on the tracking endpoint.
    if (ledger.token) {
      html = applyTracking(html, touch.html ?? "", ledger.token);
    }
    // MARKETING campaign email always carries an unsubscribe link -
    // templates using *|UNSUB|* place their own; anything else gets the
    // fallback footer (appended only when missing, so no double links -
    // the v1 blast dialog appended unconditionally and doubled them).
    // Operational sends (unsubType 'none') carry none by design.
    if (!operational && !html.includes(unsubscribeUrl)) {
      html += "<div style=\"font-family:Helvetica,Arial,sans-serif;" +
        "font-size:11px;color:#8a93a0;text-align:center;padding:18px 0;\">" +
        `<a href="${unsubscribeUrl}" style="color:#8a93a0;">Unsubscribe</a>` +
        "</div>";
    }
    const subject = renderMergeTags(touch.subject ?? "", context);

    const mailDocId = await queueMail(db, email, subject, html, {
      campaignId: ledger.campaignId,
      emailId: ledger.emailId,
      sendId: ledgerDoc.id,
    });
    await ledgerDoc.ref.update({
      status: "sent",
      sentAt: Timestamp.now(),
      mailDocId,
    });
    await db.collection(EMAILS).doc(ledger.emailId).update({
      "stats.sent": FieldValue.increment(1),
    });
    await db.collection(CAMPAIGNS).doc(ledger.campaignId).update({
      "stats.sent": FieldValue.increment(1),
    });
  } catch (err) {
    console.error("Campaign send failed", ledgerDoc.id, err);
    await ledgerDoc.ref.update({
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    }).catch(() => undefined);
  }
}

/**
 * Drains up to `budget` queued ledger docs, oldest first (composite index
 * campaign_sends(status, createdAt)).
 *
 * TIME-BOXED as well as count-boxed. sendLedgerDoc is serial and makes
 * several Firestore round trips per email, so a large budget on a slow day
 * can outlast the function timeout - and being killed mid-drain is the
 * expensive failure here: every reservation already flipped to `pending`
 * stays there until the stale-pending sweep reclaims it PENDING_RETRY_AGE_MS
 * later. Stopping voluntarily just leaves the rest `queued` for the next
 * tick, which is minutes away.
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @param {number} budget Max sends.
 * @param {number} [timeBudgetMs] Wall-clock ceiling for the loop.
 * @return {Promise<number>} How many were processed.
 */
async function drainQueued(
  db: FirebaseFirestore.Firestore,
  budget: number,
  timeBudgetMs = DRAIN_TIME_BUDGET_MS
): Promise<number> {
  if (budget <= 0) {
    return 0;
  }
  const snap = await db.collection(SENDS)
    .where("status", "==", "queued")
    .orderBy("createdAt", "asc")
    .limit(budget)
    .get();
  const touchCache = new Map<string, TouchDoc | null>();
  const deadline = Date.now() + timeBudgetMs;
  let sent = 0;
  for (const doc of snap.docs) {
    if (Date.now() >= deadline) {
      console.warn(
        `drainQueued: stopped after ${sent}/${snap.size} sends - out of time ` +
        "this run; the remainder stays queued for the next tick."
      );
      break;
    }
    await sendLedgerDoc(db, doc, touchCache);
    sent++;
  }
  return sent;
}

// ---- Callables (Admin-role; the client wizard/editor gates further via
// screen permissions) ----

export const enqueueCampaignEmail = onCall(
  {timeoutSeconds: 300},
  async (request):
  Promise<EnqueueCampaignEmailResult> => {
    await requireAdminRole(request.auth?.uid);
    const {emailId} =
      (request.data ?? {}) as Partial<EnqueueCampaignEmailRequest>;
    if (!emailId) {
      throw new HttpsError("invalid-argument", "emailId is required.");
    }
    const db = getFirestore();
    const touchSnap = await db.collection(EMAILS).doc(emailId).get();
    if (!touchSnap.exists) {
      throw new HttpsError("not-found", "Email not found.");
    }
    const touch = {id: touchSnap.id, ...touchSnap.data()} as TouchDoc;
    if (touch.status !== "draft" && touch.status !== "scheduled") {
      throw new HttpsError("failed-precondition",
        `Email is ${touch.status} - only drafts/scheduled emails can be sent.`);
    }
    const campaignSnap = await db.collection(CAMPAIGNS)
      .doc(touch.campaignId ?? "").get();
    if (!campaignSnap.exists) {
      throw new HttpsError("not-found",
        "The email's campaign no longer exists.");
    }
    const campaign =
      {id: campaignSnap.id, ...campaignSnap.data()} as CampaignDoc;

    const counts = await enqueueTouch(db, touch, campaign);
    // Small sends feel instant; anything beyond the immediate budget drains
    // on the scheduler ticks. Clamped by the SAME rolling-hour budget the
    // scheduler uses - this path used to be pure addition on top of the
    // hourly number, so an admin sending several touches in one hour could
    // push the relay past its cap with nothing anywhere noticing.
    const drained = await drainQueued(
      db, await currentSendBudget(db, IMMEDIATE_DRAIN_BUDGET));
    await finalizeSendingTouches(db);
    return {...counts, sentImmediately: drained};
  }
);

export const previewCampaignAudience = onCall(async (request):
  Promise<PreviewCampaignAudienceResult> => {
  await requireAdminRole(request.auth?.uid);
  const {audience} =
    (request.data ?? {}) as Partial<PreviewCampaignAudienceRequest>;
  if (!audience?.mode) {
    throw new HttpsError("invalid-argument", "audience.mode is required.");
  }
  const recipients = await resolveAudience(getFirestore(), audience);
  return {count: recipients.length, sample: recipients.slice(0, 10)};
});

export const sendCampaignTestEmail = onCall(async (request):
  Promise<SendCampaignTestEmailResult> => {
  await requireAdminRole(request.auth?.uid);
  const {emailId, to} =
    (request.data ?? {}) as Partial<SendCampaignTestEmailRequest>;
  if (!emailId || !to?.includes("@")) {
    throw new HttpsError("invalid-argument",
      "emailId and a valid 'to' are required.");
  }
  const db = getFirestore();
  const touchSnap = await db.collection(EMAILS).doc(emailId).get();
  if (!touchSnap.exists) {
    throw new HttpsError("not-found", "Email not found.");
  }
  const touch = touchSnap.data() ?? {};
  const context = {
    firstName: "Alex", lastName: "Sample", email: to,
    date: new Date().toLocaleDateString("en-US"),
    unsubscribeUrl:
      `${UNSUBSCRIBE_URL}?email=${encodeURIComponent(to)}&type=newsletter`,
  };
  // No ledger, no campaignMeta - a test never counts in any funnel.
  const mailDocId = await queueMail(db, to,
    "[TEST] " + renderMergeTags(touch.subject ?? "", context),
    renderMergeTags(touch.html ?? "", context));
  return {mailDocId};
});

// ---- The scheduler: one hourly tick runs every send mode ----

export const campaignSendScheduler = onSchedule(
  {
    // Six ticks an hour, not one - see the PACING / THROTTLE note at the
    // top of this file. SCHEDULER_INTERVAL_MINUTES must match this string.
    schedule: "every 10 minutes",
    timeZone: "America/New_York",
    timeoutSeconds: 300,
  },
  async () => {
    const db = getFirestore();

    // 1. Stale 'pending' reservations (a crashed run) go back to queued -
    //    same at-most-once-ish tradeoff the v1 scheduler documented.
    const staleCutoff = Date.now() - PENDING_RETRY_AGE_MS;
    const pendingSnap = await db.collection(SENDS)
      .where("status", "==", "pending").get();
    for (const doc of pendingSnap.docs) {
      const createdAt = doc.data().createdAt as Timestamp;
      if (createdAt && createdAt.toMillis() <= staleCutoff) {
        await doc.ref.update({status: "queued"});
      }
    }

    // 2. Scheduled touches whose time has arrived get enqueued.
    const scheduledSnap = await db.collection(EMAILS)
      .where("status", "==", "scheduled").get();
    for (const doc of scheduledSnap.docs) {
      const touch = {id: doc.id, ...doc.data()} as TouchDoc;
      const at = touch.sendConfig?.scheduledAt ?
        toMillis(touch.sendConfig.scheduledAt) : 0;
      if (!at || at > Date.now()) {
        continue;
      }
      const campaignSnap = await db.collection(CAMPAIGNS)
        .doc(touch.campaignId ?? "").get();
      if (!campaignSnap.exists) {
        continue;
      }
      try {
        await enqueueTouch(db, touch,
          {id: campaignSnap.id, ...campaignSnap.data()} as CampaignDoc);
      } catch (err) {
        console.error("Scheduled enqueue failed", touch.id, err);
        await doc.ref.update({
          status: "draft",
          sendError: err instanceof Error ? err.message : String(err),
        }).catch(() => undefined);
      }
    }

    // 3. Tag-triggered touches reserve newly-eligible recipients (ported
    //    from the v1 auto scheduler; the tag IS the audience).
    const triggeredSnap = await db.collection(EMAILS)
      .where("status", "==", "sending").get();
    for (const doc of triggeredSnap.docs) {
      const touch = {id: doc.id, ...doc.data()} as TouchDoc;
      if (touch.sendConfig?.mode !== "tagTriggered") {
        continue;
      }
      const trigger = touch.sendConfig.tagTrigger;
      if (!trigger?.tags?.length || trigger.afterDays == null) {
        continue;
      }
      const campaignSnap = await db.collection(CAMPAIGNS)
        .doc(touch.campaignId ?? "").get();
      const campaign =
        {id: campaignSnap.id, ...campaignSnap.data()} as CampaignDoc;
      if (!campaignSnap.exists ||
          effectiveCampaignStatus(campaign) !== "live") {
        continue;
      }
      // Same resolution enqueueTouch does (audienceOverride ?? campaign
      // audience), NOT a hardcoded "newsletter". sendLedgerDoc reads
      // unsubType to decide which opt-out flag to honour, whether to suppress
      // the unsubscribe footer entirely ('none' = operational), and the
      // &type= on the unsubscribe URL - so hardcoding it here meant a
      // tag-triggered touch on a prayer campaign checked the NEWSLETTER flag
      // and mailed someone who had opted out of prayer, and a tag-triggered
      // touch on an operational audience got a marketing unsubscribe footer
      // whose link opted the recipient out of a list they never joined.
      const unsubType = unsubTypeFor(
        touch.audienceOverride ?? campaign.audience);

      const cutoff = Timestamp.fromMillis(
        Date.now() - trigger.afterDays * DAY_MS);
      for (const tag of trigger.tags) {
        // Composite index tag_applications(tag, anchorDate).
        const apps = await db.collection(TAG_APPLICATIONS)
          .where("tag", "==", tag)
          .where("anchorDate", "<=", cutoff)
          .orderBy("anchorDate", "asc")
          .limit(MAX_SENDS_PER_RUN)
          .get();
        for (const app of apps.docs) {
          const email = (app.data().email as string ?? "").trim().toLowerCase();
          if (!email) {
            continue;
          }
          try {
            await db.collection(SENDS)
              .doc(`${touch.id}__${email}`).create({
                campaignId: campaign.id,
                emailId: touch.id,
                email,
                status: "queued",
                token: newToken(),
                unsubType,
                tag,
                anchorDate: app.data().anchorDate,
                createdAt: Timestamp.now(),
              });
          } catch {
            // already-exists = already reached by this touch.
          }
        }
      }
    }

    // 4. Drain the queue within budget, then close out finished touches.
    // Measured HERE rather than at the top of the tick: steps 1-3 above scan
    // collections and can take seconds, and a receipt queued in that window
    // has to count. 0 means the hour is already spent, so this tick does the
    // bookkeeping above and sends nothing.
    const budget = await currentSendBudget(db, MAX_SENDS_PER_RUN);
    const sent = await drainQueued(db, budget);
    await finalizeSendingTouches(db);
    // One line per tick is what makes the throttle auditable after the
    // fact - "did we stay under the cap last night?" should be answerable
    // from the logs without reconstructing it from the mail collection.
    if (sent > 0 || budget === 0) {
      console.log(
        `campaignSendScheduler: sent ${sent} of a ${budget} budget ` +
        `(cap ${SMTP_HOURLY_CAP}/hour, ${TRANSACTIONAL_RESERVE} reserved ` +
        "for transactional)."
      );
    }
  }
);

/**
 * Flips 'sending' now/scheduled touches whose queue has fully drained to
 * 'sent' (tagTriggered touches stay open - they drain forever while live).
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @return {Promise<void>} Resolves when statuses are settled.
 */
async function finalizeSendingTouches(
  db: FirebaseFirestore.Firestore
): Promise<void> {
  const sendingSnap = await db.collection(EMAILS)
    .where("status", "==", "sending").get();
  for (const doc of sendingSnap.docs) {
    const mode = (doc.data().sendConfig ?? {}).mode;
    if (mode === "tagTriggered") {
      continue;
    }
    // Composite index campaign_sends(emailId, status).
    const open = await db.collection(SENDS)
      .where("emailId", "==", doc.id)
      .where("status", "in", ["queued", "pending"])
      .limit(1)
      .get();
    if (open.empty) {
      await doc.ref.update({
        status: "sent",
        sentAt: Timestamp.now(),
      });
    }
  }
}

// ---- Delivered writeback: the Trigger Email extension stamps
// delivery.state onto the mail doc it processed; campaign sends carry
// campaignMeta, so a SUCCESS transition marks the ledger + counters.
// Guarded on deliveredAt for idempotence across extension retries.

/** How many times one recipient's mail may be handed to the relay. */
const MAX_SEND_ATTEMPTS = 3;

/**
 * Is this relay failure worth trying again?
 *
 * SMTP says so itself: a 4xx is temporary and a 5xx is permanent. The failure
 * that prompted this - "435 Unable to authenticate at present" - is the
 * textbook case, a momentary throttle that cleared in seconds while eight
 * recipients fell through it. A bad address answers 5xx and retrying it only
 * repeats the refusal.
 * @param {string} error The relay's error text.
 * @return {boolean} Whether to hand it back to the queue.
 */
export function isTransientRelayError(error: string): boolean {
  const text = String(error ?? "");
  if (/\b5\d\d\b/.test(text)) {
    return false;
  }
  return /\b4\d\d\b/.test(text) ||
    /timeout|temporarily|try again|too many|rate limit|connection/i.test(text);
}

// ---- Delivery writeback: the Trigger Email extension stamps delivery.state
// onto the mail doc it processed; campaign sends carry campaignMeta, so the
// ledger and the counters follow it.
//
// BOTH OUTCOMES, since 2026-09-04. Only SUCCESS was handled before, and the
// gap was invisible by construction: sendLedgerDoc marks a row 'sent' when the
// mail document is WRITTEN, and the relay fails afterwards - so a refusal left
// the row saying 'sent', the funnel reporting zero failures, and the recipient
// simply never getting the email. Eight people fell through exactly that on a
// 5,607-recipient send, and the only reason anyone noticed was a monitor
// watching the mail collection rather than the ledger.

export const onCampaignMailDelivered = onDocumentUpdated(
  // A LITERAL ON PURPOSE, and the only trigger in the repo that keeps one.
  // `mail` belongs to the firestore-send-email extension, whose own watch
  // path is configured in Firebase rather than in this repository - so the
  // collection cannot move even if we wanted it to, and routing this through
  // triggerPath() would imply otherwise. tenancy.spec.ts pins `mail` out of
  // TENANT_COLLECTIONS so the two statements cannot disagree.
  "mail/{id}",
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const meta = after?.campaignMeta;
    const state = after?.delivery?.state;
    if (!after || !meta?.sendId || (state !== "SUCCESS" && state !== "ERROR")) {
      return;
    }
    // Idempotent across the extension's own retries: a transition INTO the
    // state is what counts, not the state being present.
    if (before?.delivery?.state === state) {
      return;
    }

    const db = getFirestore();
    const ledgerRef = db.collection(SENDS).doc(meta.sendId);
    const ledger = await ledgerRef.get();
    if (!ledger.exists || ledger.data()?.deliveredAt) {
      return;
    }

    if (state === "SUCCESS") {
      await ledgerRef.update({deliveredAt: Timestamp.now()});
      await db.collection(EMAILS).doc(meta.emailId).update({
        "stats.delivered": FieldValue.increment(1),
      }).catch(() => undefined);
      await db.collection(CAMPAIGNS).doc(meta.campaignId).update({
        "stats.delivered": FieldValue.increment(1),
      }).catch(() => undefined);
      return;
    }

    // ---- ERROR ----
    const error = String(after.delivery?.error ?? "unknown relay error");
    const attempts = Number(ledger.data()?.sendAttempts ?? 1);
    const retryable = isTransientRelayError(error) &&
      attempts < MAX_SEND_ATTEMPTS;

    // The row was counted as sent when the mail doc was written, and it was
    // not sent - so the count comes back off whichever way this goes. A
    // campaign reporting more sends than the relay accepted is the specific
    // lie this whole change exists to stop telling.
    await db.collection(EMAILS).doc(meta.emailId).update({
      "stats.sent": FieldValue.increment(-1),
    }).catch(() => undefined);
    await db.collection(CAMPAIGNS).doc(meta.campaignId).update({
      "stats.sent": FieldValue.increment(-1),
    }).catch(() => undefined);

    if (retryable) {
      // Back to the queue for the next tick. mailDocId is cleared because it
      // names a document that failed, and keeping it would make the next
      // attempt look like the same one.
      await ledgerRef.update({
        status: "queued",
        sendAttempts: attempts + 1,
        lastError: error,
        mailDocId: FieldValue.delete(),
        sentAt: FieldValue.delete(),
      });
      console.warn(
        `Relay refused ${ledger.data()?.email} temporarily ` +
        `(attempt ${attempts}/${MAX_SEND_ATTEMPTS}) - requeued. ${error}`
      );
      return;
    }

    await ledgerRef.update({
      status: "failed",
      sendAttempts: attempts,
      error,
      failedAt: Timestamp.now(),
    });
    console.error(
      `Relay REFUSED ${ledger.data()?.email} and it will not be retried ` +
      `(attempt ${attempts}/${MAX_SEND_ATTEMPTS}). ${error}`
    );
  }
);
