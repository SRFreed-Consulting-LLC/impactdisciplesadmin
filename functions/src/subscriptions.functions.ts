import admin = require("firebase-admin");
import * as functions from "firebase-functions";
import {restrictedCors} from "./utils/security.functions";

// Unsubscribe links go out in emails to people with no account, so this
// endpoint has to stay callable without auth. The `list` query param used to
// be passed straight into `db.collection(list)` with no validation, which let
// anyone delete every document matching an arbitrary email out of ANY
// collection in the database (via the Admin SDK, which bypasses Firestore
// rules entirely). Only allow the actual subscription-list collection.
//
// Newsletter and Prayer Team subscribers used to be 2 separate collections
// (newsletter_subscriptions, prayer_team_subscriptions), each with its own
// entry in this allowlist. Merged into one collection (`subscriptions`,
// each doc annotated with a `type` field) - see the admin app's
// SubscriptionModel for the full reasoning. The 2 old collections are left
// in place, unmigrated-from - nothing reads/writes them any more, matching
// how the old Requests Manager collections were handled. Old, already-sent
// unsubscribe links (hardcoding `&list=newsletter_subscriptions` /
// `&list=prayer_team_subscriptions`) intentionally stop working after this
// change - not aliased, per explicit product decision.
const ALLOWED_LISTS = ["subscriptions"];
// Both subscription types now live in one collection, so `email` alone is
// no longer enough to scope a delete - someone subscribed to both would
// have 2 docs sharing the same email, differing only by `type`. Every
// outbound email now embeds `&type=...` alongside `&list=...` (see
// SubscriptionService.sendConfirmationEmail /
// SendSubscriptionDialogComponent in the admin app, and the equivalent
// services in impactdisciples-web) - validated against this allowlist the
// same way `list` is, not trusted as free text.
const ALLOWED_TYPES = ["newsletter", "prayer"];

exports.unsubscribe_from_email_list = functions
  .https.onRequest((request, response) => {
    return restrictedCors(request, response, async () => {
      const db = admin.firestore();

      try {
        const email = request.query.email;
        const list = request.query.list;
        const type = request.query.type;

        if (typeof list !== "string" || !ALLOWED_LISTS.includes(list)) {
          response.status(400).send("Unknown subscription list");
          return;
        }

        if (typeof type !== "string" || !ALLOWED_TYPES.includes(type)) {
          response.status(400).send("Unknown subscription type");
          return;
        }

        if (typeof email !== "string" || !email) {
          response.status(400).send("Missing email");
          return;
        }

        const collection = db.collection(list);
        const docRef = collection
          .where("email", "==", email)
          .where("type", "==", type);

        docRef.get().then((docs) => {
          docs.forEach((doc) => {
            doc.ref.delete();
          });
        }).then(() => {
          response.send("You have been successfully removed from the " + list);
        });
      } catch (err) {
        response.send(err);
      }
    });
  });
