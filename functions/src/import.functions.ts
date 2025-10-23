import admin = require("firebase-admin");
import * as functions from "firebase-functions";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const cors = require("cors")({origin: true});

exports.importJSON = functions
  .https.onRequest((request, response) => {
    return cors(request, response, async () => {
      const db = admin.firestore();

      response.set("Access-Control-Allow-Credentials", "true");
      response.set("Access-Control-Allow-Origin", "*");

      const table = request.query.table;
      const requestBody = request.body;

      console.log(requestBody.id);
      console.log(table);
      await db.collection(table as string).doc(requestBody.id).set(requestBody);

      response.send(requestBody);
    });
  });
