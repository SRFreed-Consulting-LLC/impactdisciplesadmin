import {tenantPath} from "./common/shared/lists/tenancy";
const PRODUCTS = tenantPath("products");
import {onRequest} from "firebase-functions/v2/https";
import {restrictedCors, requireStaffAuth} from "./utils/security.functions";
import {getFirestore, Timestamp} from "firebase-admin/firestore";
import {resolveVendorBase} from "./utils/vendor-hosts";
import {
  sanitizeRateRequest,
  toShipEngineAddress,
  buildLabelShipment,
} from "./utils/shipping-request";

type Dict = Record<string, unknown>;

/** A shipment built from stored data, plus what the customer paid. */
interface BuiltShipment {
  shipment: Dict;
  quotedShipping: number;
}

/**
 * Builds the shipment for a purchase's label out of SERVER-held values:
 * the purchase's own shipping address, the org address from `config`, and
 * weights re-read from the product docs. Nothing comes from the request
 * body except the purchase id (finding S3).
 * @param {string} purchaseId The purchase to ship.
 * @return {Promise<BuiltShipment|undefined>} The shipment, or undefined.
 */
async function buildShipmentForPurchase(
  purchaseId: string
): Promise<BuiltShipment | undefined> {
  const db = getFirestore();
  const [purchaseSnap, configSnap] = await Promise.all([
    db.collection("purchases").doc(purchaseId).get(),
    db.collection(tenantPath("config")).limit(1).get(),
  ]);

  const purchase = purchaseSnap.data();
  if (!purchaseSnap.exists || !purchase) return undefined;
  const config = configSnap.docs[0]?.data() ?? {};

  const items = Array.isArray(purchase.cartItems) ? purchase.cartItems : [];
  const shippable = items.filter((i: Dict) => i && i.isEvent !== true);

  // Weight is re-read from the products rather than taken off the stored
  // cart, matching how checkout-pricing re-reads price. Falls back to the
  // stored line weight only when the product doc is gone, so deleting a
  // product cannot strand an order that still has to be posted.
  const productSnaps = await Promise.all(
    shippable.map((i: Dict) => typeof i.id === "string" ?
      db.collection(PRODUCTS).doc(i.id).get() :
      Promise.resolve(undefined))
  );

  let totalWeightOunces = 0;
  shippable.forEach((item: Dict, idx: number) => {
    const product = productSnaps[idx]?.data();
    const authoritative = Number(product?.weight);
    const stored = Number(item.weight);
    const weight = Number.isFinite(authoritative) ?
      authoritative :
      (Number.isFinite(stored) ? stored : 0);
    if (!Number.isFinite(authoritative) && Number.isFinite(stored)) {
      console.warn("label weight fell back to the stored cart line", {
        purchaseId, productId: item.id,
      });
    }
    const qty = Number(item.orderQuantity);
    totalWeightOunces += weight * (Number.isFinite(qty) && qty > 0 ? qty : 1);
  });

  const name = [purchase.firstName, purchase.lastName]
    .filter((p) => typeof p === "string" && p.trim()).join(" ");
  const phone = (purchase.phone as Dict | undefined)?.number;

  const shipment = buildLabelShipment({
    shipTo: toShipEngineAddress(purchase.shippingAddress, name, phone),
    shipFrom: toShipEngineAddress(
      config.address, "Impact Disciples", config.phone
    ),
    totalWeightOunces,
  });
  if (!shipment) return undefined;

  const quoted = Number(purchase.shippingRate);
  return {
    shipment,
    quotedShipping: Number.isFinite(quoted) ? quoted : 0,
  };
}

/**
 * Reads the label's real cost out of the vendor response and records it
 * against the purchase alongside what the customer was charged, so the
 * drift can be reported on rather than guessed at.
 * @param {string} purchaseId The purchase the label belongs to.
 * @param {BuiltShipment} built What we asked the vendor for.
 * @param {Dict} result The vendor's label response.
 * @return {Promise<Dict|undefined>} The recorded drift figures.
 */
async function recordShippingCostDrift(
  purchaseId: string,
  built: BuiltShipment,
  result: Dict
): Promise<Dict | undefined> {
  const cost = (result?.shipmentCost ?? result?.shipment_cost) as Dict;
  const actual = Number(cost?.amount);
  if (!Number.isFinite(actual)) return undefined;

  const quoted = built.quotedShipping;
  const drift = {
    // What the customer was charged for shipping at checkout.
    quoted,
    // What the label actually cost the org.
    actual,
    // Positive = the org absorbed the difference.
    drift: Number((actual - quoted).toFixed(2)),
    at: Timestamp.now(),
  };

  await getFirestore().collection("purchases").doc(purchaseId).set(
    {shippingCostDrift: drift}, {merge: true}
  );
  return drift;
}

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

// Sweep finding S4. This endpoint stays UNAUTHENTICATED on purpose - the
// storefront prices shipping before a shopper has any identity - so the
// body is the whole trust boundary. Three things guard it now:
//   1. sanitizeRateRequest rebuilds the payload from named fields, so a
//      caller cannot steer our credentialed ShipEngine client.
//   2. A bad body is answered locally, without contacting the vendor.
//   3. Vendor errors are logged server-side and NOT echoed. The old code
//      returned the raw vendor object (carrier and account-scoped ids)
//      plus the caller's own body to anyone who asked, which made this a
//      rate-id oracle - the half of S3 that made it exploitable.
// maxInstances caps what an unthrottled caller can spend: with no cap, a
// loop here burns the ShipEngine quota and takes real checkout down,
// since the storefront cannot price shipping without it.
exports.get_shipping_rates = onRequest(
  {secrets: ["SHIP_ENGINE_API_KEY"], maxInstances: 10},
  (request, response) => {
    return restrictedCors(request, response, async () => {
      const clean = sanitizeRateRequest(request.body);
      if (!clean) {
        response.status(400).send({
          error: "Invalid shipping rate request",
        });
        return;
      }

      const shipengine = getShipEngineClient();

      shipengine.getRatesWithShipmentDetails(clean).then((result) => {
        response.send(result);
      }).catch((err) => {
        console.error("get_shipping_rates failed", err);

        response.status(502).send({
          error: "Unable to retrieve shipping rates",
        });
      });
    });
  });

exports.get_shipping_label = onRequest(
  {secrets: ["SHIP_ENGINE_API_KEY"], maxInstances: 10},
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
      const requestBody = request.body ?? {};
      const purchaseId = typeof requestBody.purchaseId === "string" ?
        requestBody.purchaseId.trim() :
        "";

      // Fixed for every label we buy, either path.
      const labelOptions = {
        validateAddress: "no_validation",
        labelLayout: "4x6",
        labelFormat: "pdf",
        labelDownloadType: "url",
        displayScheme: "label",
      };

      let result;
      let built: BuiltShipment | undefined;
      try {
        if (purchaseId) {
          // S3 path: build the shipment from what the SERVER has stored
          // against this purchase. The caller's rate id is not used.
          built = await buildShipmentForPurchase(purchaseId);
          if (!built) {
            response.status(400).send({
              code: 400,
              error: {message: "Purchase is not shippable."},
            });
            return;
          }
          result = await shipengine.createLabelFromShipmentDetails({
            shipment: built.shipment,
            ...labelOptions,
          });
        } else {
          // Legacy path, still used by the Shipping Labels screen, where
          // the rate was minted by a STAFF member from an address they
          // typed themselves - so there is no untrusted id to launder.
          // Slated to move onto the purchase path; see S3 in the sweep.
          const shipId = typeof requestBody.shipId === "string" ?
            requestBody.shipId :
            "";
          if (!shipId) {
            response.status(400).send({
              code: 400,
              error: {message: "purchaseId or shipId is required."},
            });
            return;
          }
          result = await shipengine.createLabelFromRate({
            rateId: shipId,
            ...labelOptions,
          });
        }
      } catch (err) {
        console.error("get_shipping_label failed", err);
        response.status(502).send({
          code: 502,
          error: {message: "Unable to purchase a shipping label."},
        });
        return;
      }

      // Cost drift: what the label actually cost us against what the
      // customer was charged at checkout. Recorded per purchase so the
      // Purchases screen can show it and the real cost of buying at label
      // time (rather than honouring a stale quote) can be measured
      // instead of argued about. Best-effort - the label is already
      // bought, so a failure to annotate must not fail the response.
      let drift;
      if (built) {
        try {
          drift = await recordShippingCostDrift(purchaseId, built, result);
        } catch (err) {
          console.error("shipping drift not recorded", purchaseId, err);
        }
      }

      response.send(drift ? {...result, shippingCostDrift: drift} : result);
    });
  });
