import {onRequest} from "firebase-functions/v2/https";
import {restrictedCors, requireStaffAuth} from "./utils/security.functions";
import {resolveVendorBase} from "./utils/vendor-hosts";

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
  // baseURL is the SDK's own documented override (ShipEngineConfig). It is
  // resolved through vendor-hosts.ts so an emulator run reaches the fake
  // vendor server instead of ShipEngine - which matters more here than
  // anywhere else, because get_shipping_label BUYS REAL POSTAGE, so no
  // automated test could ever have exercised it against the real vendor.
  return new CachedShipEngine({
    apiKey: process.env.SHIP_ENGINE_API_KEY ?? "",
    baseURL: resolveVendorBase("shipengine", "https://api.shipengine.com/"),
  });
}

exports.get_shipping_rates = onRequest(
  {secrets: ["SHIP_ENGINE_API_KEY"]},
  (request, response) => {
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

exports.get_shipping_label = onRequest(
  {secrets: ["SHIP_ENGINE_API_KEY"]},
  (request, response) => {
    return restrictedCors(request, response, async () => {
      // Purchasing a label costs real postage -- only recognized staff
      // (admin app, real Firebase Auth session) may call this.
      try {
        await requireStaffAuth(request);
      } catch {
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
