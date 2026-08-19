/* eslint-disable camelcase -- endpoint names are URL-visible and follow
   the repo's snake_case onRequest convention (subscribe_to_email_list,
   create_paypal_order, ...). */
import {onRequest} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

// Campaign Manager v2, Phase 3: OUR OWN engagement tracking - the reason
// the send engine can eventually replace Mailchimp's reports.
//
// Design (see the Campaign Manager v2 plan):
// - Every ledger doc (campaign_sends) carries a crypto-random `token`;
//   these endpoints resolve recipients BY TOKEN, so no email address ever
//   rides in a tracked URL (forwarded emails, server logs).
// - campaign_click uses a LINK MAP: the send path stores {l1: url, ...}
//   on the campaign_emails doc and rewrites hrefs to carry (token,
//   linkId). The target URL is never in the query string - that shape
//   would be an open redirect for phishing.
// - Counters increment at endpoint time (touch + campaign denormalized
//   stats; uniques gated by the ledger's first-occurrence timestamps);
//   every hit also lands in the `campaign_events` stream (staff-read,
//   function-write) for audit and future re-aggregation.
// - Opens are APPROXIMATE by nature: Gmail/Apple proxy-prefetch inflates
//   them (the UI labels them so); clicks and purchases are the funnel
//   stages to trust.

// Deterministic v2 HTTPS URLs - same env-switch idiom as UNSUBSCRIBE_URL.
export const TRACKING_BASE =
  process.env.GCLOUD_PROJECT === "impactdisciples-a82a8" ?
    "https://us-central1-impactdisciples-a82a8.cloudfunctions.net" :
    "https://us-central1-impactdisciplesdev.cloudfunctions.net";

// Where an unresolvable click lands - never an error page for a customer.
const FALLBACK_REDIRECT = "https://impactdisciples.com";

// 1x1 transparent GIF (43 bytes).
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/**
 * Resolves a recipient token to its ledger doc.
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @param {string} token The tracked token.
 * @return {Promise<FirebaseFirestore.QueryDocumentSnapshot | null>} Doc.
 */
async function ledgerByToken(
  db: FirebaseFirestore.Firestore,
  token: string
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  if (!token || token.length < 10) {
    return null;
  }
  const snap = await db.collection("campaign_sends")
    .where("token", "==", token).limit(1).get();
  return snap.empty ? null : snap.docs[0];
}

/**
 * Appends one event to the campaign_events stream.
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @param {object} event The event payload.
 * @return {Promise<void>} Resolves when written.
 */
async function recordEvent(
  db: FirebaseFirestore.Firestore,
  event: Record<string, unknown>
): Promise<void> {
  await db.collection("campaign_events").add({
    ...event,
    at: admin.firestore.Timestamp.now(),
  }).catch((err) => console.error("campaign_events write failed", err));
}

// ---- Phase 4: conversion attribution ----

// What the public site's requests may carry (AttributionService in the
// web repo). Client-supplied and therefore advisory: everything is
// length-capped and the campaign must actually exist before anything is
// credited.
export interface CampaignAttributionInput {
  campaignId?: unknown;
  emailId?: unknown;
  source?: unknown;
}

/**
 * Validates/normalizes a client-supplied attribution object.
 * @param {unknown} raw The request's attribution field.
 * @return {object | null} {campaignId, emailId?, source?} or null.
 */
export function sanitizeAttribution(
  raw: unknown
): {campaignId: string; emailId?: string; source?: string} | null {
  const input = (raw ?? {}) as CampaignAttributionInput;
  const campaignId = typeof input.campaignId === "string" ?
    input.campaignId.trim() : "";
  if (!campaignId || campaignId.length > 64) {
    return null;
  }
  const emailId = typeof input.emailId === "string" ?
    input.emailId.trim() : "";
  const source = typeof input.source === "string" ?
    input.source.trim() : "";
  return {
    campaignId,
    ...(emailId && emailId.length <= 64 ? {emailId} : {}),
    ...(source && source.length <= 32 ? {source} : {}),
  };
}

/**
 * Credits a conversion (purchase / subscribe / registration) to a
 * campaign: bumps the denormalized funnel counters on the campaign (and
 * the email touch when known) and appends a campaign_events row.
 * Best-effort by contract - attribution must NEVER fail the order/
 * subscribe/registration that carried it.
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @param {object} input Conversion details.
 * @return {Promise<void>} Resolves when recorded (or swallowed).
 */
export async function recordCampaignConversion(
  db: FirebaseFirestore.Firestore,
  input: {
    campaignId: string;
    emailId?: string;
    type: "purchase" | "subscribe" | "registration";
    via: "link" | "coupon" | "popup";
    amount?: number;
    orderId?: string;
    email?: string;
  }
): Promise<void> {
  try {
    const campaignRef = db.collection("campaigns").doc(input.campaignId);
    if (!(await campaignRef.get()).exists) {
      return; // junk/expired id - credit nothing
    }
    const bump: Record<string, unknown> = {};
    if (input.type === "purchase") {
      bump["stats.purchases"] = admin.firestore.FieldValue.increment(1);
      if (input.amount && input.amount > 0) {
        bump["stats.revenue"] =
          admin.firestore.FieldValue.increment(input.amount);
      }
    } else if (input.type === "subscribe") {
      bump["stats.subscribes"] = admin.firestore.FieldValue.increment(1);
    } else {
      bump["stats.registrations"] = admin.firestore.FieldValue.increment(1);
    }
    await campaignRef.update(bump);
    if (input.emailId) {
      await db.collection("campaign_emails").doc(input.emailId)
        .update(bump).catch(() => undefined);
    }
    await recordEvent(db, {
      type: input.type,
      campaignId: input.campaignId,
      emailId: input.emailId ?? null,
      via: input.via,
      amount: input.amount ?? null,
      orderId: input.orderId ?? null,
      email: input.email ?? null,
    });
  } catch (err) {
    console.error("recordCampaignConversion failed", input.campaignId, err);
  }
}

/**
 * Coupon fallback: a purchase with no explicit attribution but a coupon
 * code matching an effectively-live campaign's couponId still credits
 * that campaign (via 'coupon').
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @param {string} couponCode The purchase's (server-verified) coupon code.
 * @return {Promise<string | null>} The campaign id, or null.
 */
export async function campaignForCoupon(
  db: FirebaseFirestore.Firestore,
  couponCode: string
): Promise<string | null> {
  try {
    if (!couponCode?.trim()) {
      return null;
    }
    const couponSnap = await db.collection("coupons")
      .where("code", "==", couponCode.trim()).limit(1).get();
    if (couponSnap.empty) {
      return null;
    }
    const campaignSnap = await db.collection("campaigns")
      .where("couponId", "==", couponSnap.docs[0].id).limit(5).get();
    for (const doc of campaignSnap.docs) {
      const data = doc.data();
      // Inline effective-status check (campaign-send.functions.ts's
      // mirror) - only live campaigns claim coupon conversions.
      const now = Date.now();
      const end = data.endDate?.toMillis?.() ?? 0;
      const start = data.startDate?.toMillis?.() ?? 0;
      const effectivelyLive = data.status === "live" ||
        (data.status === "scheduled" && start > 0 && start <= now);
      if (effectivelyLive && !(end > 0 && end < now)) {
        return doc.id;
      }
    }
    return null;
  } catch (err) {
    console.error("campaignForCoupon failed", err);
    return null;
  }
}

// GET /campaign_open?t=<token> - the tracking pixel. Always answers with
// the GIF (an unknown token learns nothing); no-store so each real open
// re-fires through caching proxies.
export const campaign_open = onRequest(async (request, response) => {
  try {
    const db = admin.firestore();
    const ledgerDoc = await ledgerByToken(db, String(request.query.t ?? ""));
    if (ledgerDoc) {
      const ledger = ledgerDoc.data();
      const firstOpen = !ledger.openedAt;
      if (firstOpen) {
        await ledgerDoc.ref.update(
          {openedAt: admin.firestore.Timestamp.now()});
      }
      const bump: Record<string, unknown> = {
        "stats.opens": admin.firestore.FieldValue.increment(1),
      };
      if (firstOpen) {
        bump["stats.uniqueOpens"] = admin.firestore.FieldValue.increment(1);
      }
      await db.collection("campaign_emails").doc(ledger.emailId)
        .update(bump).catch(() => undefined);
      await db.collection("campaigns").doc(ledger.campaignId)
        .update(bump).catch(() => undefined);
      await recordEvent(db, {
        type: "open",
        campaignId: ledger.campaignId,
        emailId: ledger.emailId,
        sendId: ledgerDoc.id,
        ua: request.headers["user-agent"] ?? null,
      });
    }
  } catch (err) {
    console.error("campaign_open failed", err);
  }
  response.set("Cache-Control", "no-store, no-cache, must-revalidate");
  response.set("Content-Type", "image/gif");
  response.status(200).send(PIXEL);
});

// GET /campaign_web_event?cid=<campaignId>&type=web_shown|web_click -
// the popup beacon (Campaign Manager v2, Phase 5). CORS-open by design:
// it's an anonymous public-site beacon carrying nothing sensitive, and
// the campaign must exist AND be effectively live before anything counts.
// The web renderer localStorage-guards web_shown to once per visitor per
// popup, which also caps write volume.
export const campaign_web_event = onRequest(async (request, response) => {
  response.set("Access-Control-Allow-Origin", "*");
  try {
    const cid = String(request.query.cid ?? "").trim();
    const type = String(request.query.type ?? "");
    if (!cid || cid.length > 64 ||
        (type !== "web_shown" && type !== "web_click")) {
      response.status(204).send("");
      return;
    }
    const db = admin.firestore();
    const campaignSnap = await db.collection("campaigns").doc(cid).get();
    const data = campaignSnap.data();
    if (campaignSnap.exists && data) {
      const now = Date.now();
      const start = data.startDate?.toMillis?.() ?? 0;
      const end = data.endDate?.toMillis?.() ?? 0;
      const live = (data.status === "live" ||
        (data.status === "scheduled" && start > 0 && start <= now)) &&
        !(end > 0 && end < now);
      if (live) {
        const field = type === "web_shown" ?
          "stats.webShown" : "stats.webClicks";
        await campaignSnap.ref.update({
          [field]: admin.firestore.FieldValue.increment(1),
        });
        await recordEvent(db, {
          type,
          campaignId: cid,
          via: "popup",
          ua: request.headers["user-agent"] ?? null,
        });
      }
    }
  } catch (err) {
    console.error("campaign_web_event failed", err);
  }
  response.status(204).send("");
});

// GET /campaign_click?t=<token>&l=<linkId> - tracked redirect. The target
// comes from the touch's stored link map, never the query string.
export const campaign_click = onRequest(async (request, response) => {
  let target = FALLBACK_REDIRECT;
  try {
    const db = admin.firestore();
    const linkId = String(request.query.l ?? "");
    const ledgerDoc = await ledgerByToken(db, String(request.query.t ?? ""));
    if (ledgerDoc) {
      const ledger = ledgerDoc.data();
      const touchSnap = await db.collection("campaign_emails")
        .doc(ledger.emailId).get();
      const mapped = touchSnap.data()?.links?.[linkId];
      if (typeof mapped === "string" && /^https?:\/\//.test(mapped)) {
        target = mapped;
      }

      const firstClick = !ledger.clickedAt;
      const ledgerPatch: Record<string, unknown> = {};
      if (firstClick) {
        ledgerPatch.clickedAt = admin.firestore.Timestamp.now();
      }
      // A click proves an open even when images were blocked - backfill
      // the unique open, but never the raw opens counter (no pixel fired).
      const backfillOpen = !ledger.openedAt;
      if (backfillOpen) {
        ledgerPatch.openedAt = admin.firestore.Timestamp.now();
      }
      if (Object.keys(ledgerPatch).length > 0) {
        await ledgerDoc.ref.update(ledgerPatch);
      }
      const bump: Record<string, unknown> = {
        "stats.clicks": admin.firestore.FieldValue.increment(1),
      };
      if (firstClick) {
        bump["stats.uniqueClicks"] = admin.firestore.FieldValue.increment(1);
      }
      if (backfillOpen) {
        bump["stats.uniqueOpens"] = admin.firestore.FieldValue.increment(1);
      }
      await db.collection("campaign_emails").doc(ledger.emailId)
        .update(bump).catch(() => undefined);
      await db.collection("campaigns").doc(ledger.campaignId)
        .update(bump).catch(() => undefined);
      await recordEvent(db, {
        type: "click",
        campaignId: ledger.campaignId,
        emailId: ledger.emailId,
        sendId: ledgerDoc.id,
        linkId,
        url: target,
        ua: request.headers["user-agent"] ?? null,
      });
    }
  } catch (err) {
    console.error("campaign_click failed", err);
  }
  response.redirect(302, target);
});
