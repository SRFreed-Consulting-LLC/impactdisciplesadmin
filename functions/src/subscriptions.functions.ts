import admin = require("firebase-admin");
import * as functions from "firebase-functions";
import {restrictedCors} from "./utils/security.functions";

// Unsubscribe links go out in emails to people with no account, so this
// endpoint has to stay callable without auth. The `list` query param used to
// be passed straight into `db.collection(list)` with no validation, which let
// anyone delete every document matching an arbitrary email out of ANY
// collection in the database (via the Admin SDK, which bypasses Firestore
// rules entirely). Only allow the actual subscription-list collections.
const ALLOWED_LISTS = ["newsletter_subscriptions", "prayer_team_subscriptions"];

exports.unsubscribe_from_email_list = functions
  .https.onRequest((request, response) => {
    return restrictedCors(request, response, async () => {
      const db = admin.firestore();

      try {
        const email = request.query.email;
        const list = request.query.list;

        if (typeof list !== "string" || !ALLOWED_LISTS.includes(list)) {
          response.status(400).send("Unknown subscription list");
          return;
        }

        if (typeof email !== "string" || !email) {
          response.status(400).send("Missing email");
          return;
        }

        const collection = db.collection(list);
        const docRef = collection.where("email", "==", email);

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
