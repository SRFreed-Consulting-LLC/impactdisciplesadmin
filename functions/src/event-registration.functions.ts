import {onRequest} from "firebase-functions/v2/https";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {restrictedCors} from "./utils/security.functions";
import {escapeHtml} from "./transactional-emails";
import {
  recordCampaignConversion,
  sanitizeAttribution,
} from "./campaign-tracking.functions";
import {
  RegisterForEventRequest,
  UpdateMySessionsRequest,
} from "./common/shared/contract/web-http.types";

/**
 * Pre-prod checklist #2: the public event-registration flows, moved
 * server-side. The identity model is unchanged and deliberate: attendees
 * have no accounts - "whoever holds the emailed link owns the
 * registration" - so the registration doc's own auto-generated id (~120
 * bits of randomness, embedded in the confirmation email's breakout link)
 * IS the credential. What changes is that the collection is no longer
 * world-open around that model: previously ANYONE could query
 * registrations by email (emails are guessable; links aren't), stream
 * every event's full attendee roster (names + emails), and overwrite
 * whole registration docs. Now:
 *
 * - register_for_event: creates the registration, renders + queues the
 *   confirmation email (mail_templates substitution, same mechanism the
 *   client used), stamps receiptEmailId - one call replaces the client's
 *   create/email/update dance. The breakout link's domain is PINNED
 *   server-side (WEB_APP_DOMAIN env, dev default) - accepting a
 *   client-supplied domain would let an abuser send phishing links
 *   dressed in this project's own email template.
 * - get_event_registration: fetch by unguessable id only - the by-email
 *   lookup path is gone.
 * - update_my_sessions: narrow arrayUnion/arrayRemove on
 *   trainingSessions, credentialed by registration id - no more
 *   anonymous whole-doc setDoc.
 * - check_registration_exists: boolean-only duplicate check for the
 *   signup form's validator - confirms existence without disclosing data.
 * - get_session_counts: per-session registration COUNTS only - the
 *   schedule's capacity display never needed names/emails (verified: its
 *   consumers only ever read .length).
 *
 * firestore.rules then locks event-registrations to staff; the admin
 * app's attendee screens are unaffected (role claim).
 */
const db = admin.firestore();

// Server-pinned domain for the breakout-registration link in the
// confirmation email. Env override wins; otherwise the production project
// uses the real web domain and every other project the dev origin (same
// GCLOUD_PROJECT switch as the PayPal base URL / READER_APP_ORIGIN).
const WEB_APP_DOMAIN =
  process.env.WEB_APP_DOMAIN ||
  (process.env.GCLOUD_PROJECT === "impactdisciples-a82a8" ?
    "https://impactdisciples.com" :
    "https://impactdisciplesdev.web.app");

/**
 * Crude but sufficient HTML-to-text for the email's plain-text part -
 * mirrors the client's htmlToPlainText usage.
 * @param {string} html The rendered email html.
 * @return {string} A plain-text rendition.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Renders and queues the registration confirmation email from the
 * event's own mail template (client-parity: mail_templates doc by name,
 * {{placeholder}} substitution into html + subject), returning the mail
 * doc's id. Best-effort by design - a missing/broken template must not
 * fail the registration itself.
 * @param {FirebaseFirestore.DocumentData} event The event doc's data.
 * @param {string} eventId The event doc id (for the breakout link).
 * @param {string} registrationId The new registration's id.
 * @param {{firstName: string, lastName: string, email: string}} who The
 * attendee.
 * @return {Promise<string | undefined>} The queued mail doc id.
 */
async function queueConfirmationEmail(
  event: FirebaseFirestore.DocumentData,
  eventId: string,
  registrationId: string,
  who: {firstName: string; lastName: string; email: string}
): Promise<string | undefined> {
  try {
    const templateName = event.emailTemplate as string | undefined;
    if (!templateName) {
      return undefined;
    }
    const templateSnap = await db
      .collection("mail_templates")
      .where("name", "==", templateName)
      .limit(1)
      .get();
    if (templateSnap.empty) {
      logger.warn("Registration email template not found", {templateName});
      return undefined;
    }
    const template = templateSnap.docs[0].data() as {
      html?: string;
      subject?: string;
    };

    const start =
      event.startDate?.toDate ? (event.startDate.toDate() as Date) : undefined;
    const startText = start ?
      start.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }) +
        " at " +
        start.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        }) :
      "";
    // firstName/lastName/email are attacker-controlled (public register
    // endpoint), so they are HTML-escaped before interpolation
    // (sweep 2026-08-17). eventName is staff-authored but escaped too for
    // consistency; editRegistration is a server-built link with a
    // server-pinned domain and an unguessable id, safe as-is.
    const model: Record<string, string> = {
      firstName: escapeHtml(who.firstName),
      lastName: escapeHtml(who.lastName),
      email: escapeHtml(who.email),
      eventName: escapeHtml((event.eventName as string) ?? ""),
      startDate: escapeHtml(startText),
      editRegistration:
        "<a href='" +
        WEB_APP_DOMAIN +
        "/events/" +
        eventId +
        "/registrations/" +
        registrationId +
        "'>Register for Breakout</a>",
    };

    let html = template.html ?? "";
    for (const [key, value] of Object.entries(model)) {
      html = html.split("{{" + key + "}}").join(value);
    }
    // Subject is plain text (not HTML), so use the raw event name here,
    // not the HTML-escaped model value.
    const subject = (template.subject ?? "").replace(
      "{{eventName}}",
      (event.eventName as string) ?? ""
    );

    const mailRef = await db.collection("mail").add({
      to: who.email,
      date: Timestamp.now(),
      message: {subject, html, text: htmlToText(html)},
    });
    return mailRef.id;
  } catch (err) {
    logger.error("Failed to queue registration email", {
      registrationId,
      err: String(err),
    });
    return undefined;
  }
}

/** Creates a registration + confirmation email. POST {eventId, firstName,
 *  lastName, email, receipt?}. Returns {registrationId, receiptEmailId?}. */
export const registerForEventHttp = onRequest((request, response) => {
  return restrictedCors(request, response, async () => {
    if (request.method !== "POST") {
      response.status(405).send({error: "POST required."});
      return;
    }
    const body =
      (request.body ?? {}) as Partial<RegisterForEventRequest>;
    const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
    const firstName =
      typeof body.firstName === "string" ?
        body.firstName.trim().slice(0, 100) :
        "";
    const lastName =
      typeof body.lastName === "string" ?
        body.lastName.trim().slice(0, 100) :
        "";
    const email =
      typeof body.email === "string" ?
        body.email.trim().toLowerCase().slice(0, 200) :
        "";
    const receipt =
      typeof body.receipt === "string" ? body.receipt.trim().slice(0, 200) : "";
    if (!eventId || !firstName || !lastName || !email.includes("@")) {
      response.status(400).send({
        error: "eventId, firstName, lastName and a valid email are required.",
      });
      return;
    }

    const eventSnap = await db.collection("events").doc(eventId).get();
    const eventData = eventSnap.data();
    // earlyRegistration (2026-08-20, user feature): a summit can accept
    // sign-ups BEFORE it goes live on the public site - the summit page
    // keeps its coming-soon placeholder and the events list still hides
    // it; the only way in is the direct /event-details/{id} link an
    // early-bird campaign carries. Live OR early-registration accepts.
    const registrationOpen =
      eventData?.isActive !== false || eventData?.earlyRegistration === true;
    if (!eventSnap.exists || !eventData || !registrationOpen) {
      response.status(400).send({error: "Event not found or inactive."});
      return;
    }

    const registrationRef = await db.collection("event-registrations").add({
      firstName,
      lastName,
      // Case-insensitive sort key for the admin Attendees table's paged
      // orderBy (Firestore sorts by code point, so "williams" would
      // otherwise outrank "Zonn"). Backfilled onto existing docs by
      // scripts/backfill-registration-lastname-lower.js.
      lastNameLower: lastName.toLowerCase(),
      eventId,
      email,
      receipt,
      registrationDate: Timestamp.now(),
      trainingSessions: [],
      loggedIn: false,
    });

    const receiptEmailId = await queueConfirmationEmail(
      eventData,
      eventId,
      registrationRef.id,
      {firstName, lastName, email}
    );
    if (receiptEmailId) {
      await registrationRef.update({receiptEmailId});
    }

    // Campaign attribution (Campaign Manager v2, Phase 4): a registration
    // that followed a campaign link/popup credits that campaign's funnel.
    // Best-effort; validated + existence-checked inside.
    const attribution = sanitizeAttribution(body.attribution);
    if (attribution) {
      await recordCampaignConversion(db, {
        campaignId: attribution.campaignId,
        emailId: attribution.emailId,
        type: "registration",
        via: attribution.source === "popup" ? "popup" : "link",
        orderId: registrationRef.id,
        email,
      });
    }

    logger.info("Event registration created", {
      eventId,
      registrationId: registrationRef.id,
    });
    response.send({registrationId: registrationRef.id, receiptEmailId});
  });
});

/** Fetch by unguessable registration id (the emailed link's credential).
 *  POST {registrationId}. */
export const getEventRegistrationHttp = onRequest((request, response) => {
  return restrictedCors(request, response, async () => {
    if (request.method !== "POST") {
      response.status(405).send({error: "POST required."});
      return;
    }
    const registrationId =
      typeof request.body?.registrationId === "string" ?
        request.body.registrationId.trim() :
        "";
    if (!registrationId) {
      response.status(400).send({error: "registrationId is required."});
      return;
    }
    const snap = await db
      .collection("event-registrations")
      .doc(registrationId)
      .get();
    const data = snap.data();
    if (!snap.exists || !data) {
      response.send({registration: null});
      return;
    }
    response.send({
      registration: {
        id: snap.id,
        firstName: data.firstName ?? "",
        lastName: data.lastName ?? "",
        eventId: data.eventId ?? "",
        email: data.email ?? "",
        receipt: data.receipt ?? "",
        trainingSessions: data.trainingSessions ?? [],
        registrationDateIso:
          data.registrationDate?.toDate?.()?.toISOString() ?? null,
      },
    });
  });
});

/** Narrow breakout-session mutation, credentialed by registration id.
 *  POST {registrationId, sessionId, action: 'add'|'remove'}. */
export const updateMySessionsHttp = onRequest((request, response) => {
  return restrictedCors(request, response, async () => {
    if (request.method !== "POST") {
      response.status(405).send({error: "POST required."});
      return;
    }
    const body =
      (request.body ?? {}) as Partial<UpdateMySessionsRequest>;
    const registrationId =
      typeof body.registrationId === "string" ? body.registrationId.trim() : "";
    const sessionId =
      typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    const action = body.action === "remove" ? "remove" : "add";
    if (!registrationId || !sessionId) {
      response.status(400).send({
        error: "registrationId and sessionId are required.",
      });
      return;
    }
    const ref = db.collection("event-registrations").doc(registrationId);
    const snap = await ref.get();
    if (!snap.exists) {
      response.status(404).send({error: "Registration not found."});
      return;
    }
    await ref.update({
      trainingSessions:
        action === "add" ?
          FieldValue.arrayUnion(sessionId) :
          FieldValue.arrayRemove(sessionId),
    });
    const updated = await ref.get();
    response.send({trainingSessions: updated.data()?.trainingSessions ?? []});
  });
});

/** Boolean-only duplicate check for the signup form's validator - never
 *  discloses registration contents. POST {eventId, email}. */
export const checkRegistrationExistsHttp = onRequest((request, response) => {
  return restrictedCors(request, response, async () => {
    if (request.method !== "POST") {
      response.status(405).send({error: "POST required."});
      return;
    }
    const eventId =
      typeof request.body?.eventId === "string" ?
        request.body.eventId.trim() :
        "";
    const email =
      typeof request.body?.email === "string" ?
        request.body.email.trim().toLowerCase() :
        "";
    if (!eventId || !email) {
      response.status(400).send({error: "eventId and email are required."});
      return;
    }
    const snap = await db
      .collection("event-registrations")
      .where("eventId", "==", eventId)
      .where("email", "==", email)
      .limit(1)
      .get();
    response.send({exists: !snap.empty});
  });
});

/**
 * Extracts a registration's trainingSessions as a de-duplicated list of
 * string session ids (defensive: the field is arrayUnion-maintained so it
 * should already be unique strings, but a hand-edited doc must not be able
 * to skew the counters).
 * @param {FirebaseFirestore.DocumentData | undefined} data A registration
 * doc's data (or undefined for the missing side of a create/delete).
 * @return {string[]} The unique session ids.
 */
function sessionIdsOf(
  data: FirebaseFirestore.DocumentData | undefined
): string[] {
  const raw = data?.trainingSessions;
  if (!Array.isArray(raw)) {
    return [];
  }
  return [...new Set(raw.filter((s): s is string => typeof s === "string"))];
}

/**
 * Recomputes an event's per-session counts from the registrations
 * themselves. select() keeps this a single-field read - no names/emails
 * ever leave Firestore for this.
 * @param {string} eventId The event whose registrations to count.
 * @param {FirebaseFirestore.Transaction} [tx] Optional transaction to read
 * within (used by the self-seeding path).
 * @return {Promise<Record<string, number>>} sessionId -> registration count.
 */
async function computeSessionCounts(
  eventId: string,
  tx?: FirebaseFirestore.Transaction
): Promise<Record<string, number>> {
  const query = db
    .collection("event-registrations")
    .where("eventId", "==", eventId)
    .select("trainingSessions");
  const snap = tx ? await tx.get(query) : await query.get();
  const counts: Record<string, number> = {};
  for (const d of snap.docs) {
    for (const session of sessionIdsOf(d.data())) {
      counts[session] = (counts[session] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Live per-event session-count counters ('eventSessionCounts/{eventId}',
 * shape {counts: {sessionId: n}, updatedAt, seeded}) so the public
 * schedule's capacity display no longer re-reads every registration doc on
 * each page view (get_session_counts below serves the meta doc instead).
 * Diffs the trainingSessions arrays across the write and applies
 * FieldValue.increment deltas: create = all +1, delete = all -1, update =
 * the symmetric difference. A registration switching eventId (impossible
 * via the public endpoints, handled defensively for admin/manual edits)
 * moves all its sessions from the old event's counter doc to the new one's.
 * Counter docs are functions-only (no firestore.rules match = default
 * deny); negatives from any missed/misordered event are clamped to 0 at
 * serve time.
 */
export const onEventRegistrationSessionCounts = onDocumentWritten(
  "event-registrations/{id}",
  async (event) => {
    const beforeSnap = event.data?.before;
    const afterSnap = event.data?.after;
    const beforeData = beforeSnap?.exists ? beforeSnap.data() : undefined;
    const afterData = afterSnap?.exists ? afterSnap.data() : undefined;

    const beforeEventId =
      typeof beforeData?.eventId === "string" ? beforeData.eventId : "";
    const afterEventId =
      typeof afterData?.eventId === "string" ? afterData.eventId : "";
    const beforeSessions = sessionIdsOf(beforeData);
    const afterSessions = sessionIdsOf(afterData);

    // Per-event, per-session deltas for this write.
    const deltas = new Map<string, Map<string, number>>();
    const bump = (eventId: string, sessionId: string, by: number) => {
      if (!eventId || !sessionId) {
        return;
      }
      const forEvent = deltas.get(eventId) ?? new Map<string, number>();
      forEvent.set(sessionId, (forEvent.get(sessionId) ?? 0) + by);
      deltas.set(eventId, forEvent);
    };

    if (beforeEventId === afterEventId) {
      for (const s of afterSessions) {
        if (!beforeSessions.includes(s)) {
          bump(afterEventId, s, 1);
        }
      }
      for (const s of beforeSessions) {
        if (!afterSessions.includes(s)) {
          bump(beforeEventId, s, -1);
        }
      }
    } else {
      // eventId changed (or create/delete, where one side is ''): the old
      // event loses every session, the new event gains every session.
      for (const s of beforeSessions) {
        bump(beforeEventId, s, -1);
      }
      for (const s of afterSessions) {
        bump(afterEventId, s, 1);
      }
    }

    for (const [eventId, sessions] of deltas) {
      const counts: Record<string, FieldValue> = {};
      let hasDelta = false;
      for (const [sessionId, delta] of sessions) {
        if (delta !== 0) {
          counts[sessionId] = FieldValue.increment(delta);
          hasDelta = true;
        }
      }
      if (!hasDelta) {
        continue;
      }
      await db.collection("eventSessionCounts").doc(eventId).set(
        {counts, updatedAt: Timestamp.now()},
        {merge: true}
      );
    }
  }
);

/** Per-session registration counts for the schedule's capacity display -
 *  the only thing the public page ever needed from the full roster.
 *  POST {eventId}. Served from the 'eventSessionCounts/{eventId}' counter
 *  doc the trigger above maintains; a not-yet-seeded event self-seeds by
 *  recomputing from the registrations (single-field select(), no PII) and
 *  persisting the result - no manual backfill step. The transaction makes
 *  seeding overwrite-safe against concurrent trigger increments (a
 *  conflicting increment forces a retry that recounts). `seeded` (not bare
 *  existence) gates serving, since the trigger may have created the doc
 *  with only post-deploy deltas before the first read ever happened. */
export const getSessionCountsHttp = onRequest((request, response) => {
  return restrictedCors(request, response, async () => {
    if (request.method !== "POST") {
      response.status(405).send({error: "POST required."});
      return;
    }
    const eventId =
      typeof request.body?.eventId === "string" ?
        request.body.eventId.trim() :
        "";
    if (!eventId) {
      response.status(400).send({error: "eventId is required."});
      return;
    }
    const metaRef = db.collection("eventSessionCounts").doc(eventId);
    const counts = await db.runTransaction(async (tx) => {
      const metaSnap = await tx.get(metaRef);
      const meta = metaSnap.exists ? metaSnap.data() : undefined;
      if (meta?.seeded === true) {
        return (meta.counts ?? {}) as Record<string, number>;
      }
      const seededCounts = await computeSessionCounts(eventId, tx);
      tx.set(metaRef, {
        counts: seededCounts,
        seeded: true,
        updatedAt: Timestamp.now(),
      });
      return seededCounts;
    });
    // Serve-time clamp: a stray negative (missed event, out-of-order
    // delivery) must never render as a negative headcount.
    const clamped: Record<string, number> = {};
    for (const [sessionId, n] of Object.entries(counts)) {
      clamped[sessionId] = typeof n === "number" ? Math.max(0, n) : 0;
    }
    response.send({counts: clamped});
  });
});
