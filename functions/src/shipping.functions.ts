/* eslint-disable @typescript-eslint/no-var-requires */
import * as functions from "firebase-functions";
import {restrictedCors, requireStaffAuth} from "./utils/security.functions";

const ShipEngine = require("shipengine");

exports.get_shipping_rates = functions
  .runWith({secrets: ["SHIP_ENGINE_API_KEY"]})
  .https.onRequest((request, response) => {
    return restrictedCors(request, response, async () => {
      const shipengine = new ShipEngine(process.env.SHIP_ENGINE_API_KEY);

      const requestBody = request.body;

      shipengine.getRatesWithShipmentDetails(requestBody).then((result) => {
        response.send(result);
      }).catch((err) => {
        console.log(JSON.stringify(err));

        response.send({
          code: 400,
          body: request.body,
          error: err,
        });
      });
    });
  });

exports.get_shipping_label = functions
  .runWith({secrets: ["SHIP_ENGINE_API_KEY"]})
  .https.onRequest((request, response) => {
    return restrictedCors(request, response, async () => {
      // Purchasing a label costs real postage -- only recognized staff
      // (admin app, real Firebase Auth session) may call this.
      try {
        await requireStaffAuth(request);
      } catch (err) {
        response.status(401).send({code: 401, error: "Unauthorized"});
        return;
      }

      const shipengine = new ShipEngine(process.env.SHIP_ENGINE_API_KEY);

      const requestBody = request.body;

      const params = {
        rateId: requestBody.shipId,
        validateAddress: "no_validation",
        labelLayout: "4x6",
        labelFormat: "pdf",
        labelDownloadType: "url",
        displayScheme: "label",
      };

      shipengine.createLabelFromRate(params).then((result) => {
        response.send(result);
      }).catch((err) => {
        console.log(JSON.stringify(err));

        response.send({
          code: 400,
          body: request.body,
          error: err,
        });
      });
    });
  });
