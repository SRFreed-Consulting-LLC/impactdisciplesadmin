import {onRequest} from "firebase-functions/v2/https";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {restrictedCors} from "./utils/security.functions";
import {escapeHtml} from "./transactional-emails";

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
    const body = (request.body ?? {}) as Record<string, unknown>;
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
    if (!eventSnap.exists || eventSnap.data()?.isActive === false) {
      response.status(400).send({error: "Event not found or inactive."});
      return;
    }

    const registrationRef = await db.collection("event-registrations").add({
      firstName,
      lastName,
      eventId,
      email,
      receipt,
      registrationDate: Timestamp.now(),
      trainingSessions: [],
      loggedIn: false,
    });

    const receiptEmailId = await queueConfirmationEmail(
      eventSnap.data()!,
      eventId,
      registrationRef.id,
      {firstName, lastName, email}
    );
    if (receiptEmailId) {
      await registrationRef.update({receiptEmailId});
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
    if (!snap.exists) {
      response.send({registration: null});
      return;
    }
    const data = snap.data()!;
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
    const body = (request.body ?? {}) as Record<string, unknown>;
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

/** Per-session registration counts for the schedule's capacity display -
 *  the only thing the public page ever needed from the full roster.
 *  POST {eventId}. */
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
    const snap = await db
      .collection("event-registrations")
      .where("eventId", "==", eventId)
      .get();
    const counts: Record<string, number> = {};
    for (const d of snap.docs) {
      const sessions = (d.data().trainingSessions ?? []) as string[];
      for (const session of sessions) {
        counts[session] = (counts[session] ?? 0) + 1;
      }
    }
    response.send({counts});
  });
});
