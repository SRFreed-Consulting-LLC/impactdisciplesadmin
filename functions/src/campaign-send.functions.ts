import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {onDocumentUpdated} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import * as crypto from "crypto";
import {requireAdminRole} from "./admin-users.functions";
import {queueMail, UNSUBSCRIBE_URL} from "./transactional-emails";
import {renderMergeTags} from "./utils/merge-tags.functions";
import {toMillis} from "./utils/date-normalize.functions";

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
// Pacing: MAX_SENDS_PER_RUN per hourly tick. The Trigger Email extension
// relays through the org's OWN mail server (mail.impactdisciples.com:26 -
// verified 2026-08-18), a shared-hosting-style server whose hourly cap is
// unconfirmed; 200/hour is the conservative default until the hosting
// provider confirms a number. A full-list blast (~2,400) therefore rolls
// out over ~12 hours - accepted by the user (2026-08-18 Q&A).

const MAX_SENDS_PER_RUN = 200;
const IMMEDIATE_DRAIN_BUDGET = 25;
const PENDING_RETRY_AGE_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type AudienceSpec = {
  mode?: "everyone" | "flags" | "tags" | "list";
  flags?: string[];
  tags?: string[];
  emails?: string[];
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
  sendConfig?: {
    mode?: "now" | "scheduled" | "tagTriggered";
    scheduledAt?: unknown;
    tagTrigger?: {tags?: string[]; afterDays?: number} | null;
  } | null;
  audienceOverride?: AudienceSpec | null;
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
    (await db.collection("customers").get()).docs
      .forEach((d) => addDoc(d.data()));
  } else if (audience.mode === "flags") {
    const flags = (audience.flags ?? []).filter((f) =>
      f === "subscribedToNewsletter" || f === "subscribedToPrayerTeam");
    for (const flag of flags) {
      (await db.collection("customers").where(flag, "==", true).get())
        .docs.forEach((d) => addDoc(d.data()));
    }
  } else if (audience.mode === "tags") {
    const tags = (audience.tags ?? []).filter(Boolean);
    // array-contains-any accepts at most 10 values per query.
    for (let i = 0; i < tags.length; i += 10) {
      (await db.collection("customers")
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
      db.collection("campaign_sends").doc(`${touch.id}__${email}`),
      {
        campaignId: campaign.id,
        emailId: touch.id,
        email,
        status: "queued",
        token: newToken(),
        unsubType,
        createdAt: admin.firestore.Timestamp.now(),
      }
    ).then(() => queued++).catch(() => undefined);
  }
  await writer.close();

  await db.collection("campaign_emails").doc(touch.id).update({
    status: "sending",
    recipientCount: recipients.length,
  });
  // A sending campaign is live (drafts only; regrouped history that gets a
  // fresh touch keeps its own stored status).
  if (campaign.status === "draft") {
    await db.collection("campaigns").doc(campaign.id).update({
      status: "live",
      startDate: admin.firestore.Timestamp.now(),
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
      const snap = await db.collection("campaign_emails")
        .doc(ledger.emailId).get();
      touch = snap.exists ? {id: snap.id, ...snap.data()} as TouchDoc : null;
      touchCache.set(ledger.emailId, touch);
    }
    if (!touch) {
      await ledgerDoc.ref.update(
        {status: "failed", error: "email touch deleted"});
      return;
    }

    const customerSnap = await db.collection("customers")
      .where("email", "==", email).limit(1).get();
    const customer = customerSnap.empty ? {} : customerSnap.docs[0].data();

    // Honor an unsubscribe that landed between enqueue and send.
    const unsubFlag = ledger.unsubType === "prayer" ?
      "subscribedToPrayerTeam" : "subscribedToNewsletter";
    if (customer[unsubFlag] === false) {
      await ledgerDoc.ref.update({
        status: "skipped",
        error: `customer unsubscribed (${ledger.unsubType})`,
        sentAt: admin.firestore.Timestamp.now(),
      });
      return;
    }

    const unsubscribeUrl =
      `${UNSUBSCRIBE_URL}?email=${encodeURIComponent(email)}` +
      `&type=${ledger.unsubType ?? "newsletter"}`;
    const context = {
      firstName: customer.firstName ?? "",
      lastName: customer.lastName ?? "",
      email,
      date: new Date().toLocaleDateString("en-US"),
      unsubscribeUrl,
    };
    let html = renderMergeTags(touch.html ?? "", context);
    // Campaign email is marketing - it ALWAYS carries an unsubscribe link.
    // Templates using *|UNSUB|* place their own; anything else gets the
    // fallback footer (appended only when missing, so no double links -
    // the v1 blast dialog appended unconditionally and doubled them).
    if (!html.includes(unsubscribeUrl)) {
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
      sentAt: admin.firestore.Timestamp.now(),
      mailDocId,
    });
    await db.collection("campaign_emails").doc(ledger.emailId).update({
      "stats.sent": admin.firestore.FieldValue.increment(1),
    });
    await db.collection("campaigns").doc(ledger.campaignId).update({
      "stats.sent": admin.firestore.FieldValue.increment(1),
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
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @param {number} budget Max sends.
 * @return {Promise<number>} How many were processed.
 */
async function drainQueued(
  db: FirebaseFirestore.Firestore,
  budget: number
): Promise<number> {
  if (budget <= 0) {
    return 0;
  }
  const snap = await db.collection("campaign_sends")
    .where("status", "==", "queued")
    .orderBy("createdAt", "asc")
    .limit(budget)
    .get();
  const touchCache = new Map<string, TouchDoc | null>();
  for (const doc of snap.docs) {
    await sendLedgerDoc(db, doc, touchCache);
  }
  return snap.size;
}

// ---- Callables (Admin-role; the client wizard/editor gates further via
// screen permissions) ----

export const enqueueCampaignEmail = onCall(
  {timeoutSeconds: 300},
  async (request) => {
    await requireAdminRole(request.auth?.uid);
    const {emailId} = (request.data ?? {}) as {emailId?: string};
    if (!emailId) {
      throw new HttpsError("invalid-argument", "emailId is required.");
    }
    const db = admin.firestore();
    const touchSnap = await db.collection("campaign_emails").doc(emailId).get();
    if (!touchSnap.exists) {
      throw new HttpsError("not-found", "Email not found.");
    }
    const touch = {id: touchSnap.id, ...touchSnap.data()} as TouchDoc;
    if (touch.status !== "draft" && touch.status !== "scheduled") {
      throw new HttpsError("failed-precondition",
        `Email is ${touch.status} - only drafts/scheduled emails can be sent.`);
    }
    const campaignSnap = await db.collection("campaigns")
      .doc(touch.campaignId ?? "").get();
    if (!campaignSnap.exists) {
      throw new HttpsError("not-found",
        "The email's campaign no longer exists.");
    }
    const campaign =
      {id: campaignSnap.id, ...campaignSnap.data()} as CampaignDoc;

    const counts = await enqueueTouch(db, touch, campaign);
    // Small sends feel instant; anything beyond the immediate budget
    // drains on the hourly ticks.
    const drained = await drainQueued(db, IMMEDIATE_DRAIN_BUDGET);
    await finalizeSendingTouches(db);
    return {...counts, sentImmediately: drained};
  }
);

export const previewCampaignAudience = onCall(async (request) => {
  await requireAdminRole(request.auth?.uid);
  const {audience} = (request.data ?? {}) as {audience?: AudienceSpec};
  if (!audience?.mode) {
    throw new HttpsError("invalid-argument", "audience.mode is required.");
  }
  const recipients = await resolveAudience(admin.firestore(), audience);
  return {count: recipients.length, sample: recipients.slice(0, 10)};
});

export const sendCampaignTestEmail = onCall(async (request) => {
  await requireAdminRole(request.auth?.uid);
  const {emailId, to} =
    (request.data ?? {}) as {emailId?: string; to?: string};
  if (!emailId || !to?.includes("@")) {
    throw new HttpsError("invalid-argument",
      "emailId and a valid 'to' are required.");
  }
  const db = admin.firestore();
  const touchSnap = await db.collection("campaign_emails").doc(emailId).get();
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
    schedule: "every 60 minutes",
    timeZone: "America/New_York",
    timeoutSeconds: 300,
  },
  async () => {
    const db = admin.firestore();
    const budget = MAX_SENDS_PER_RUN;

    // 1. Stale 'pending' reservations (a crashed run) go back to queued -
    //    same at-most-once-ish tradeoff the v1 scheduler documented.
    const staleCutoff = Date.now() - PENDING_RETRY_AGE_MS;
    const pendingSnap = await db.collection("campaign_sends")
      .where("status", "==", "pending").get();
    for (const doc of pendingSnap.docs) {
      const createdAt = doc.data().createdAt as admin.firestore.Timestamp;
      if (createdAt && createdAt.toMillis() <= staleCutoff) {
        await doc.ref.update({status: "queued"});
      }
    }

    // 2. Scheduled touches whose time has arrived get enqueued.
    const scheduledSnap = await db.collection("campaign_emails")
      .where("status", "==", "scheduled").get();
    for (const doc of scheduledSnap.docs) {
      const touch = {id: doc.id, ...doc.data()} as TouchDoc;
      const at = touch.sendConfig?.scheduledAt ?
        toMillis(touch.sendConfig.scheduledAt) : 0;
      if (!at || at > Date.now()) {
        continue;
      }
      const campaignSnap = await db.collection("campaigns")
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
    const triggeredSnap = await db.collection("campaign_emails")
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
      const campaignSnap = await db.collection("campaigns")
        .doc(touch.campaignId ?? "").get();
      const campaign =
        {id: campaignSnap.id, ...campaignSnap.data()} as CampaignDoc;
      if (!campaignSnap.exists ||
          effectiveCampaignStatus(campaign) !== "live") {
        continue;
      }
      const cutoff = admin.firestore.Timestamp.fromMillis(
        Date.now() - trigger.afterDays * DAY_MS);
      for (const tag of trigger.tags) {
        // Composite index tag_applications(tag, anchorDate).
        const apps = await db.collection("tag_applications")
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
            await db.collection("campaign_sends")
              .doc(`${touch.id}__${email}`).create({
                campaignId: campaign.id,
                emailId: touch.id,
                email,
                status: "queued",
                token: newToken(),
                unsubType: "newsletter",
                tag,
                anchorDate: app.data().anchorDate,
                createdAt: admin.firestore.Timestamp.now(),
              });
          } catch {
            // already-exists = already reached by this touch.
          }
        }
      }
    }

    // 4. Drain the queue within budget, then close out finished touches.
    await drainQueued(db, budget);
    await finalizeSendingTouches(db);
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
  const sendingSnap = await db.collection("campaign_emails")
    .where("status", "==", "sending").get();
  for (const doc of sendingSnap.docs) {
    const mode = (doc.data().sendConfig ?? {}).mode;
    if (mode === "tagTriggered") {
      continue;
    }
    // Composite index campaign_sends(emailId, status).
    const open = await db.collection("campaign_sends")
      .where("emailId", "==", doc.id)
      .where("status", "in", ["queued", "pending"])
      .limit(1)
      .get();
    if (open.empty) {
      await doc.ref.update({
        status: "sent",
        sentAt: admin.firestore.Timestamp.now(),
      });
    }
  }
}

// ---- Delivered writeback: the Trigger Email extension stamps
// delivery.state onto the mail doc it processed; campaign sends carry
// campaignMeta, so a SUCCESS transition marks the ledger + counters.
// Guarded on deliveredAt for idempotence across extension retries.

export const onCampaignMailDelivered = onDocumentUpdated(
  "mail/{id}",
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const meta = after?.campaignMeta;
    if (!after || !meta?.sendId ||
        after.delivery?.state !== "SUCCESS" ||
        before?.delivery?.state === "SUCCESS") {
      return;
    }
    const db = admin.firestore();
    const ledgerRef = db.collection("campaign_sends").doc(meta.sendId);
    const ledger = await ledgerRef.get();
    if (!ledger.exists || ledger.data()?.deliveredAt) {
      return;
    }
    await ledgerRef.update({deliveredAt: admin.firestore.Timestamp.now()});
    await db.collection("campaign_emails").doc(meta.emailId).update({
      "stats.delivered": admin.firestore.FieldValue.increment(1),
    }).catch(() => undefined);
    await db.collection("campaigns").doc(meta.campaignId).update({
      "stats.delivered": admin.firestore.FieldValue.increment(1),
    }).catch(() => undefined);
  }
);
