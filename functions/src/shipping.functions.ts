/* eslint-disable @typescript-eslint/no-var-requires */
import * as functions from "firebase-functions";

const ShipEngine = require("shipengine");

const cors = require("cors")({origin: true});

exports.get_shipping_rates = functions
  .runWith({secrets: ["SHIP_ENGINE_API_KEY"]})
  .https.onRequest((request, response) => {
    return cors(request, response, async () => {
      const shipengine = new ShipEngine(process.env.SHIP_ENGINE_API_KEY);

      response.set("Access-Control-Allow-Credentials", "true");
      response.set("Access-Control-Allow-Origin", "*");

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
    return cors(request, response, async () => {
      const shipengine = new ShipEngine(process.env.SHIP_ENGINE_API_KEY);

      response.set("Access-Control-Allow-Credentials", "true");
      response.set("Access-Control-Allow-Origin", "*");

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
