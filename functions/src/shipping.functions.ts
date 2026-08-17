/* eslint-disable @typescript-eslint/no-var-requires */
import * as functions from "firebase-functions";
import {restrictedCors, requireStaffAuth} from "./utils/security.functions";

// Lazily required on first use rather than at module load: index.ts pulls
// this file in unconditionally, so a top-level require would put the whole
// ShipEngine SDK on EVERY function's cold-start path, not just the two
// shipping endpoints that actually use it. The loaded constructor is cached
// module-level so only the first shipping call per instance pays the load.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let CachedShipEngine: any;

/**
 * Loads (once per warm instance) the ShipEngine SDK and returns a client
 * bound to the SHIP_ENGINE_API_KEY secret.
 * @return {any} A ShipEngine client instance.
 */
function getShipEngineClient() {
  if (!CachedShipEngine) {
    CachedShipEngine = require("shipengine");
  }
  return new CachedShipEngine(process.env.SHIP_ENGINE_API_KEY);
}

exports.get_shipping_rates = functions
  .runWith({secrets: ["SHIP_ENGINE_API_KEY"]})
  .https.onRequest((request, response) => {
    return restrictedCors(request, response, async () => {
      const shipengine = getShipEngineClient();

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

      const shipengine = getShipEngineClient();

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
