/* eslint-disable camelcase -- endpoint names are URL-visible and follow
   the repo's snake_case onRequest convention (subscribe_to_email_list,
   campaign_web_event, ...). */
import {onRequest} from "firebase-functions/v2/https";
import {renderMergeTags} from "./utils/merge-tags.functions";
import {toMillis} from "./utils/date-normalize.functions";
import {getFirestore} from "firebase-admin/firestore";

// Public newsletter archive (2026-08-20): the web app's Monthly Newsletter
// page used to read a hand-maintained `monthly-newsletter` collection of
// Mailchimp archive URLs. Since Campaign Manager v2 every sent email's
// html snapshot lives on its campaign_emails touch, so the archive is now
// a staff-set flag ON THE TOUCH (`publishToWeb`, plus an optional
// `webTitle` override) and this endpoint is the ONLY public read path:
//
//   GET /newsletter_archive          -> {newsletters: [{id, title, date}]}
//   GET /newsletter_archive?id=<id>  -> text/html of that one touch
//
// Why a function and not a rules change: campaign_emails carries audience
// overrides, link maps and stats - never public-readable. This serves
// exactly title/date/html and nothing else, and only for touches an admin
// explicitly flagged. The flag is curated on purpose: the public list was
// never "every newsletter-kind send" (the regrouped Monthly Newsletter
// campaign holds promos too, and published issues came from the prayer
// letter and standalone campaigns as well - see
// backfill-newsletter-archive.js, removed 2026-08-21).

const ARCHIVE_LIMIT = 200;

/**
 * Whether a touch is publicly visible: flagged AND actually gone out.
 * 'sending' counts - a large paced send is final html from the first
 * batch, and the public issue shouldn't lag hours behind the first
 * recipients.
 * @param {FirebaseFirestore.DocumentData | undefined} data Touch doc data.
 * @return {boolean} True when the archive may serve it.
 */
export function isPublishedTouch(
  data: FirebaseFirestore.DocumentData | undefined
): boolean {
  return !!data && data.publishToWeb === true &&
    (data.status === "sent" || data.status === "sending");
}

/**
 * The public display title: admin override, then label, then subject.
 * @param {FirebaseFirestore.DocumentData} data Touch doc data.
 * @return {string} Display title.
 */
export function archiveTitle(data: FirebaseFirestore.DocumentData): string {
  const candidate = [data.webTitle, data.label, data.subject]
    .find((v) => typeof v === "string" && v.trim() !== "");
  return (candidate ?? "Newsletter").trim();
}

/**
 * Escapes text for inclusion in html.
 * @param {string} text Raw text.
 * @return {string} Escaped text.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Turns a stored touch html snapshot into a standalone public document:
 * - renders our merge tags with an anonymous context (no recipient; the
 *   unsubscribe link goes nowhere - an archive page has no subscriber),
 * - resolves Mailchimp's *|MC:SUBJECT|* to the title and STRIPS every
 *   other Mailchimp-only tag the imports still carry (*|IF:...|*,
 *   *|END:IF|*, *|ARCHIVE|*, *|UPDATE_PROFILE|*, *|MC_PREVIEW_TEXT|* ...),
 * - drops <script> blocks and inline on* handlers (defense in depth - the
 *   web renders this in a script-less sandboxed iframe and this endpoint
 *   sends script-src 'none', but the snapshot should be clean regardless),
 * - wraps a bare fragment (our own Quill-authored sends) in a minimal
 *   readable document; imports are already full documents.
 * @param {string} rawHtml The touch's stored html.
 * @param {string} title The public title (used for MC:SUBJECT and <title>).
 * @return {string} Servable html.
 */
export function prepareArchiveHtml(rawHtml: string, title: string): string {
  let html = renderMergeTags(rawHtml ?? "", {
    firstName: "",
    lastName: "",
    email: "",
    date: "",
    senderFirstName: "",
    senderLastName: "",
    tracking: "",
    unsubscribeUrl: "#",
  });
  const safeTitle = escapeHtml(title);
  html = html.split("*|MC:SUBJECT|*").join(safeTitle);
  html = html.replace(/\*\|[^|*]*\|\*/g, "");
  html = html.replace(/<script[\s\S]*?<\/script\s*>/gi, "");
  html = html.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  if (/<html[\s>]/i.test(html)) {
    return html;
  }
  return "<!DOCTYPE html><html><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    `<title>${safeTitle}</title>` +
    "<style>body{margin:0;padding:24px 16px;background:#fff;color:#222;" +
    "font-family:Helvetica,Arial,sans-serif;line-height:1.5}" +
    ".newsletter{max-width:680px;margin:0 auto}" +
    "img{max-width:100%;height:auto}</style></head>" +
    `<body><div class="newsletter">${html}</div></body></html>`;
}

/**
 * sentAt in whatever of the three stored shapes -> ISO string or null.
 * @param {unknown} value Stored sentAt.
 * @return {string | null} ISO date.
 */
function isoDate(value: unknown): string | null {
  const millis = toMillis(value);
  return millis > 0 ? new Date(millis).toISOString() : null;
}

// GET /newsletter_archive[?id=<campaignEmailId>] - see header comment.
// CORS-open like campaign_web_event: the public site fetches both the list
// JSON and the issue html (rendered via srcdoc so the page can size the
// frame to its content).
export const newsletter_archive = onRequest(async (request, response) => {
  response.set("Access-Control-Allow-Origin", "*");
  if (request.method === "OPTIONS") {
    response.set("Access-Control-Allow-Methods", "GET");
    response.set("Access-Control-Max-Age", "86400");
    response.status(204).send("");
    return;
  }
  if (request.method !== "GET") {
    response.status(405).type("text/plain").send("Method not allowed");
    return;
  }
  const db = getFirestore();
  const id = String(request.query.id ?? "").trim();
  try {
    if (id) {
      if (id.length > 64 || !/^[A-Za-z0-9_-]+$/.test(id)) {
        response.status(404).type("text/plain").send("Not found");
        return;
      }
      const snap = await db.collection("campaign_emails").doc(id).get();
      const data = snap.data();
      if (!snap.exists || !data || !isPublishedTouch(data)) {
        response.status(404).type("text/plain").send("Not found");
        return;
      }
      response.set("Cache-Control", "public, max-age=3600");
      response.set("Content-Security-Policy",
        "script-src 'none'; base-uri 'none'; form-action 'none'");
      response.type("html")
        .send(prepareArchiveHtml(data.html ?? "", archiveTitle(data)));
      return;
    }

    // Composite index: campaign_emails(publishToWeb ASC, sentAt DESC).
    // Status is filtered in code so the index stays two-field (and
    // because publishToWeb is only ever set on sent/sending touches).
    const snap = await db.collection("campaign_emails")
      .where("publishToWeb", "==", true)
      .orderBy("sentAt", "desc")
      .limit(ARCHIVE_LIMIT)
      .get();
    const newsletters = snap.docs
      .filter((d) => isPublishedTouch(d.data()))
      .map((d) => ({
        id: d.id,
        title: archiveTitle(d.data()),
        date: isoDate(d.data().sentAt),
      }));
    response.set("Cache-Control", "public, max-age=300");
    response.json({newsletters});
  } catch (err) {
    console.error("newsletter_archive failed", err);
    response.status(500).json({error: "newsletter_archive failed"});
  }
});
