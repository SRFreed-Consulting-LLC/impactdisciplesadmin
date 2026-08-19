import {onSchedule} from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import {queueMail, UNSUBSCRIBE_URL} from "./transactional-emails";
import {renderMergeTags} from "./utils/merge-tags.functions";
import {toMillis} from "./utils/date-normalize.functions";

// The auto-campaign sender - this repo's FIRST scheduled function (the
// initial deploy enables the Cloud Scheduler API and creates the job).
// Every hour: for each effectively-live 'auto' campaign, find
// tag_applications whose tag is targeted and whose anchorDate (the
// purchase/registration that tagged the customer) is at least
// sendAfterDays old, and queue the campaign email to each such customer -
// AT MOST ONCE per (campaign, customer), enforced by an atomic ledger
// create on campaign_sends/{campaignId__email}.
//
// Failure model: reserve-then-send. A crash between the ledger create and
// queueMail leaves a 'pending' ledger doc; runs re-process pending docs
// older than 2h (the pending doc is the lock, still at-most-once-ish). A
// queueMail rejection lands status 'failed' with the error for manual
// inspection rather than silent retry-forever.
//
// Burst smoothing: launching an automation against a tag with a large
// retroactive population makes everyone past their wait eligible at once.
// MAX_SENDS_PER_RUN drains that backlog oldest-anchor-first at a rate that
// protects sender reputation - deliberate, not a bug. The Trigger Email
// extension's own SMTP quota is the true ceiling.
//
// Opt-out: customers with subscribedToNewsletter === false (an explicit
// unsubscribe) are skipped - automated marketing honors it; customers with
// no flag at all are included. Their ledger doc is written as 'skipped'
// so they aren't re-evaluated every run.

const MAX_SENDS_PER_RUN = 200;
const PENDING_RETRY_AGE_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface AutoCampaignDoc {
  id: string;
  name?: string;
  type?: string;
  status?: string;
  startDate?: unknown;
  endDate?: unknown;
  subject?: string | null;
  message?: string | null;
  emailTemplateId?: string | null;
  targetTags?: string[] | null;
  sendAfterDays?: number | null;
}

/**
 * Mirror of the client's effectiveStatus() (campaign.model.ts) - statuses
 * auto-promote by date at read time, so the stored value alone would miss
 * scheduled campaigns whose start has arrived.
 * @param {AutoCampaignDoc} campaign The campaign doc.
 * @return {string} The effective status.
 */
export function effectiveCampaignStatus(campaign: AutoCampaignDoc): string {
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

/**
 * Builds the outgoing email html for one recipient: the campaign's email
 * template when set (falling back to the plain message), merge tags
 * rendered with the customer's values and a per-recipient unsubscribe URL.
 * @param {AutoCampaignDoc} campaign The campaign.
 * @param {string | null} templateHtml The mail_templates html, if any.
 * @param {object} customer Customer names ({firstName, lastName}).
 * @param {string} email Recipient email.
 * @return {string} Rendered html.
 */
function buildEmailHtml(
  campaign: AutoCampaignDoc,
  templateHtml: string | null,
  customer: {firstName?: string; lastName?: string},
  email: string
): string {
  const raw = templateHtml ??
    "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:14px;" +
    "line-height:1.6;color:#333;\">" +
    `<p>Hi *|FNAME|*,</p><p>${campaign.message ?? ""}</p></div>`;
  return renderMergeTags(raw, {
    firstName: customer.firstName ?? "",
    lastName: customer.lastName ?? "",
    email,
    date: new Date().toLocaleDateString("en-US"),
    unsubscribeUrl:
      `${UNSUBSCRIBE_URL}?email=${encodeURIComponent(email)}&type=newsletter`,
  });
}

export const autoCampaignScheduler = onSchedule(
  {
    schedule: "every 60 minutes",
    timeZone: "America/New_York",
    timeoutSeconds: 300,
  },
  async () => {
    const db = admin.firestore();
    let budget = MAX_SENDS_PER_RUN;

    // ---- 1. Load effectively-live auto campaigns.
    const campaignSnap = await db.collection("campaigns")
      .where("type", "==", "auto").get();
    const liveCampaigns = campaignSnap.docs
      .map((doc) => ({id: doc.id, ...doc.data()} as AutoCampaignDoc))
      .filter((campaign) =>
        effectiveCampaignStatus(campaign) === "live" &&
        (campaign.targetTags?.length ?? 0) > 0 &&
        campaign.sendAfterDays != null);
    if (liveCampaigns.length === 0) {
      return;
    }

    // ---- 2. Retry stale 'pending' reservations first (crashed runs).
    const staleCutoff = admin.firestore.Timestamp.fromMillis(
      Date.now() - PENDING_RETRY_AGE_MS
    );
    const staleSnap = await db.collection("campaign_sends")
      .where("status", "==", "pending").get();
    for (const doc of staleSnap.docs) {
      if (budget <= 0) {
        break;
      }
      const data = doc.data();
      const createdAt = data.createdAt as admin.firestore.Timestamp;
      if (!createdAt || createdAt.toMillis() > staleCutoff.toMillis()) {
        continue;
      }
      const campaign = liveCampaigns.find((c) => c.id === data.campaignId);
      if (!campaign) {
        await doc.ref.update({
          status: "failed",
          error: "campaign no longer live at retry time",
        });
        continue;
      }
      budget--;
      await sendForLedgerDoc(db, campaign, doc.ref, data.email as string);
    }

    // ---- 3. Per campaign, per tag: find eligible applications and send.
    for (const campaign of liveCampaigns) {
      if (budget <= 0) {
        break;
      }
      const cutoff = admin.firestore.Timestamp.fromMillis(
        Date.now() - (campaign.sendAfterDays ?? 0) * DAY_MS
      );
      const templateHtml = await loadTemplateHtml(db, campaign);

      for (const tag of campaign.targetTags ?? []) {
        if (budget <= 0) {
          break;
        }
        // Composite index (tag ASC, anchorDate ASC) -
        // firestore.indexes.json. Oldest anchors first so a retroactive
        // backlog drains in a fair order.
        const applicationsSnap = await db.collection("tag_applications")
          .where("tag", "==", tag)
          .where("anchorDate", "<=", cutoff)
          .orderBy("anchorDate", "asc")
          .limit(budget)
          .get();

        for (const application of applicationsSnap.docs) {
          if (budget <= 0) {
            break;
          }
          const email = (application.data().email as string ?? "")
            .trim().toLowerCase();
          if (!email) {
            continue;
          }
          const ledgerRef = db.collection("campaign_sends")
            .doc(`${campaign.id}__${email}`);
          try {
            // Atomic reservation - throws already-exists when this
            // customer was already sent/reserved/skipped for this
            // campaign (incl. by an overlapping run).
            await ledgerRef.create({
              campaignId: campaign.id,
              email,
              tag,
              anchorDate: application.data().anchorDate,
              status: "pending",
              createdAt: admin.firestore.Timestamp.now(),
            });
          } catch {
            continue;
          }
          budget--;
          await sendForLedgerDoc(db, campaign, ledgerRef, email, templateHtml);
        }
      }
    }
  }
);

/**
 * Loads the campaign's mail_templates html once per campaign per run.
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @param {AutoCampaignDoc} campaign The campaign.
 * @return {Promise<string | null>} The template html, or null.
 */
async function loadTemplateHtml(
  db: FirebaseFirestore.Firestore,
  campaign: AutoCampaignDoc
): Promise<string | null> {
  if (!campaign.emailTemplateId) {
    return null;
  }
  const snap = await db.collection("mail_templates")
    .doc(campaign.emailTemplateId).get();
  const html = snap.exists ? snap.data()?.html : null;
  return typeof html === "string" && html.trim() ? html : null;
}

/**
 * Completes one reserved ledger doc: resolve the customer, honor the
 * explicit-unsubscribe opt-out, queue the email, mark the ledger, bump
 * the campaign's emailsSent stat.
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @param {AutoCampaignDoc} campaign The campaign.
 * @param {FirebaseFirestore.DocumentReference} ledgerRef The reservation.
 * @param {string} email Recipient email.
 * @param {string | null} [templateHtmlCached] Pre-loaded template html.
 * @return {Promise<void>} Resolves when the ledger doc is finalized.
 */
async function sendForLedgerDoc(
  db: FirebaseFirestore.Firestore,
  campaign: AutoCampaignDoc,
  ledgerRef: FirebaseFirestore.DocumentReference,
  email: string,
  templateHtmlCached?: string | null
): Promise<void> {
  try {
    const customerSnap = await db.collection("customers")
      .where("email", "==", email).limit(1).get();
    const customer = customerSnap.empty ? {} : customerSnap.docs[0].data();

    if (customer.subscribedToNewsletter === false) {
      await ledgerRef.update({
        status: "skipped",
        error: "customer explicitly unsubscribed from newsletter",
        sentAt: admin.firestore.Timestamp.now(),
      });
      return;
    }

    const templateHtml = templateHtmlCached !== undefined ?
      templateHtmlCached :
      await loadTemplateHtml(db, campaign);
    const html = buildEmailHtml(campaign, templateHtml, customer, email);
    const subject = renderMergeTags(campaign.subject ?? campaign.name ?? "", {
      firstName: customer.firstName ?? "",
      lastName: customer.lastName ?? "",
      email,
    });

    const mailDocId = await queueMail(db, email, subject, html);
    await ledgerRef.update({
      status: "sent",
      sentAt: admin.firestore.Timestamp.now(),
      mailDocId,
    });
    await db.collection("campaigns").doc(campaign.id).update({
      "stats.emailsSent": admin.firestore.FieldValue.increment(1),
    });
  } catch (err) {
    console.error("Auto-campaign send failed", campaign.id, email, err);
    await ledgerRef.update({
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    }).catch(() => undefined);
  }
}
