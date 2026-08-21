import {Timestamp, getFirestore} from "firebase-admin/firestore";
// v1 (1st-gen) API on purpose: firebase-functions >= 6 exports the v2 API at
// the package root; these HTTP functions stay 1st-gen (same URLs, runtime,
// secrets plumbing) until a deliberate 2nd-gen migration.
import * as functions from "firebase-functions/v1";
import {restrictedCors} from "./utils/security.functions";
import {queueSubscriptionConfirmation} from "./transactional-emails";
import {
  recordCampaignConversion,
  sanitizeAttribution,
} from "./campaign-tracking.functions";
import {
  SubscribeToEmailListRequest,
} from "./common/shared/contract/web-http.types";

// Newsletter/Prayer Team subscription state used to be its own collection
// (`subscriptions`, one doc per email+type) - it's now just 2 booleans on
// the matching "customers" doc (see customer.model.ts's own comment:
// `subscribedToNewsletter`/`subscribedToPrayerTeam`, each with a
// `*SubscribedDate`). This file is the 2 endpoints that flip those flags
// from outside the admin app - the public site has no direct write access
// to "customers" (see customer-upsert.functions.ts, the only other writer,
// which is itself server-side-only), so both directions go through here.
//
// Both stay callable without auth - people subscribing/unsubscribing from
// emails have no account.
const ALLOWED_TYPES = ["newsletter", "prayer"];

/**
 * Maps a subscription `type` query/body param to the CustomerModel field
 * pair it drives.
 * @param {string} type "newsletter" or "prayer".
 * @return {{flagField: string, dateField: string}} The matching
 * boolean/date field names on a "customers" doc.
 */
function fieldsForType(
  type: string
): {flagField: string; dateField: string} {
  return type === "prayer" ?
    {
      flagField: "subscribedToPrayerTeam",
      dateField: "prayerTeamSubscribedDate",
    } :
    {
      flagField: "subscribedToNewsletter",
      dateField: "newsletterSubscribedDate",
    };
}

// Site visitors subscribing (impactdisciples-web's SubscriptionService) used
// to `add()` straight into the `subscriptions` collection - now they POST
// here instead. Matched by email (lowercased/trimmed), same as every other
// customer-record writer (see customer-upsert.functions.ts's own comment) -
// an existing customer just gets the flag/date merged in, a brand-new email
// gets a bare customer record created (mirroring the shape
// onPurchaseCustomerUpsert creates for a first-time purchaser). Unlike a
// purchase's name/phone/address, a subscribe action never queues a
// PendingCustomerChange - a first/last name mismatch on a newsletter
// signup isn't worth flagging for manual review the way a shipping address
// is.
exports.subscribe_to_email_list = functions
  .https.onRequest((request, response) => {
    return restrictedCors(request, response, async () => {
      try {
        const body =
          (request.body ?? {}) as Partial<SubscribeToEmailListRequest>;
        // Trim + length-cap (same 100/200 pattern as the event-registration
        // endpoints) - these land on a customers doc and get interpolated
        // into the branded confirmation email, so they must not be
        // unbounded.
        const email = typeof body.email === "string" ?
          body.email.trim().toLowerCase().slice(0, 200) : "";
        const firstName = typeof body.firstName === "string" ?
          body.firstName.trim().slice(0, 100) : "";
        const lastName = typeof body.lastName === "string" ?
          body.lastName.trim().slice(0, 100) : "";
        const type = body.type;

        if (typeof type !== "string" || !ALLOWED_TYPES.includes(type)) {
          response.status(400).send(
            {code: 400, error: "Unknown subscription type"}
          );
          return;
        }
        if (!email || !email.includes("@")) {
          response.status(400).send(
            {code: 400, error: "Missing or invalid email"}
          );
          return;
        }

        const {flagField, dateField} = fieldsForType(type);
        const now = Timestamp.now();
        const db = getFirestore();
        const existingSnap = await db.collection("customers")
          .where("email", "==", email)
          .limit(1)
          .get();

        // alreadySubscribed lets callers (impactdisciples-web's
        // SubscriptionService) keep showing a distinct "you're already on
        // this list" message instead of a flat success toast every time -
        // same UX the old createSubscription()'s null-vs-object return
        // gave them back when this was a direct Firestore query against
        // the `subscriptions` collection.
        let alreadySubscribed = false;

        if (existingSnap.empty) {
          await db.collection("customers").add({
            firstName,
            lastName,
            email,
            role: "Customer",
            notes: [],
            pendingChanges: [],
            [flagField]: true,
            [dateField]: now,
          });
        } else {
          alreadySubscribed = existingSnap.docs[0].data()[flagField] === true;
          await existingSnap.docs[0].ref.update({
            [flagField]: true,
            [dateField]: now,
          });
        }

        // Pre-prod #1: the confirmation email is queued here now (the web
        // client's SubscriptionService.sendConfirmationEmail is retired,
        // and the `mail` collection no longer accepts anonymous creates).
        // Fresh subscribes only - same behavior the client had. Best-effort:
        // the subscription itself already saved.
        if (!alreadySubscribed) {
          try {
            await queueSubscriptionConfirmation(db, type, firstName, email);
          } catch (mailErr) {
            functions.logger.error(
              "Failed to queue subscription confirmation", mailErr
            );
          }
          // Campaign attribution (Campaign Manager v2, Phase 4): a FRESH
          // subscribe that followed a campaign link/popup credits that
          // campaign's funnel. Best-effort; validated inside.
          const attribution = sanitizeAttribution(body.attribution);
          if (attribution) {
            await recordCampaignConversion(db, {
              campaignId: attribution.campaignId,
              emailId: attribution.emailId,
              type: "subscribe",
              via: attribution.source === "popup" ? "popup" : "link",
              email,
            });
          }
        }

        response.send({subscribed: true, alreadySubscribed});
      } catch (err) {
        functions.logger.error("subscribe_to_email_list failed", err);
        response.status(500).send("Something went wrong");
      }
    });
  });

// Unsubscribe links go out in emails to people with no account, so this
// endpoint has to stay callable without auth. The `list` query param used to
// be passed straight into `db.collection(list)` with no validation, which
// let anyone delete every document matching an arbitrary email out of ANY
// collection in the database (via the Admin SDK, which bypasses Firestore
// rules entirely) - now that this always targets the hardcoded "customers"
// collection (never a request-supplied one), that whole class of issue is
// gone, and `list` is no longer read at all. Still accepted (and ignored)
// so already-sent unsubscribe links, which embed `&list=subscriptions`,
// keep working unchanged.
//
// `type` (validated against ALLOWED_TYPES) picks which of the 2 flags to
// clear - matches a customer's `email` (someone subscribed to both
// Newsletter and Prayer Team is one "customers" doc now, not 2 docs
// differing only by `type`, but still needs `type` to know which flag this
// particular link is for). The `*SubscribedDate` field is left alone on
// unsubscribe - it records "last subscribed", not "currently subscribed
// since", so it stays meaningful history if they resubscribe later.
exports.unsubscribe_from_email_list = functions
  .https.onRequest((request, response) => {
    return restrictedCors(request, response, async () => {
      try {
        const email = request.query.email;
        const type = request.query.type;

        if (typeof type !== "string" || !ALLOWED_TYPES.includes(type)) {
          response.status(400).send("Unknown subscription type");
          return;
        }

        if (typeof email !== "string" || !email) {
          response.status(400).send("Missing email");
          return;
        }

        const {flagField} = fieldsForType(type);
        // Customer emails are stored lowercased/trimmed (see subscribe
        // path); normalize here too so a mixed-case or padded value in an
        // unsubscribe link still matches instead of silently no-op'ing.
        const normalizedEmail = email.trim().toLowerCase();
        const db = getFirestore();
        const matches = await db.collection("customers")
          .where("email", "==", normalizedEmail)
          .get();

        await Promise.all(
          matches.docs.map((doc) => doc.ref.update({[flagField]: false}))
        );

        response.send("You have been successfully removed from the list");
      } catch (err) {
        functions.logger.error("unsubscribe_from_email_list failed", err);
        response.status(500).send("Unable to process unsubscribe request");
      }
    });
  });
