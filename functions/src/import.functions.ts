import admin = require("firebase-admin");
import * as functions from "firebase-functions";
import {restrictedCors, requireStaffAuth} from "./utils/security.functions";

// No caller anywhere in impactdisciples-admin or impactdisciples-web -- this
// is a manual data-migration utility, invoked directly (curl/Postman) by a
// developer. Previously had no auth at all and its own permissive
// cors({origin: true}) + a hand-set "Access-Control-Allow-Origin: *", on top
// of writing request.query.table/request.body straight into
// db.collection(table).doc(id).set(body) with no validation -- anyone who
// found the URL could create or overwrite any document in any collection,
// bypassing Firestore rules entirely via the Admin SDK. Now requires a real
// staff Firebase Auth session, same as every other function that writes
// data on the caller's behalf (see requireStaffAuth's own comment).
exports.importJSON = functions
  .https.onRequest((request, response) => {
    return restrictedCors(request, response, async () => {
      try {
        await requireStaffAuth(request);
      } catch (err) {
        response.status(401).send({code: 401, error: "Unauthorized"});
        return;
      }

      const db = admin.firestore();

      const table = request.query.table;
      const requestBody = request.body;

      await db.collection(table as string).doc(requestBody.id).set(requestBody);

      response.send(requestBody);
    });
  });
