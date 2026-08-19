/* eslint-disable @typescript-eslint/no-var-requires */
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import {restrictedCors} from "./utils/security.functions";
import {queueWebOrderEmails} from "./transactional-emails";
import {
  computeOrderPricing,
  PricingCartItemInput,
  PricingResult,
} from "./utils/checkout-pricing.functions";

// Server-side counterpart to impactdisciples-web's checkout.component.ts.
// Two public HTTP functions (no requireStaffAuth -- anonymous storefront
// checkout must be able to call these, same tier as create_payment_intent
// in stripe.functions.ts): create_paypal_order recomputes the real order
// total from Firestore and either writes a verified free Purchase directly
// or creates a real PayPal order for that total; capture_paypal_order
// captures payment against a previously-created order, cross-checks the
// captured amount, and only then writes the final Purchase record. See
// checkout-pricing.functions.ts for the actual price/discount/tax math, and
// the plan doc referenced in that repo's memory for the full design.
//
// PAYPAL_CLIENT_SECRET is a Firebase Secret Manager secret, provisioned the
// same way STRIPE_SECRET_KEY already is (`firebase functions:secrets:set
// PAYPAL_CLIENT_SECRET`) -- separately per project. The dev/sandbox value
// was set against impactdisciplesdev on 2026-08-12; a separate LIVE value
// must be provisioned against impactdisciples-a82a8 before this is ever
// deployed to prod -- never reuse the sandbox secret there.

const PAYPAL_API_BASE = process.env.GCLOUD_PROJECT === "impactdisciples-a82a8" ?
  "https://api-m.paypal.com" :
  "https://api-m.sandbox.paypal.com";

let cachedToken: {value: string; expiresAt: number} | null = null;

/**
 * Obtains (and short-term caches, per warm function instance) a PayPal
 * OAuth2 client-credentials access token. Calling PayPal's REST API
 * directly via fetch rather than an SDK -- the current recommended Node
 * package for this was churning at the time this was written and its exact
 * call shape couldn't be confirmed; plain fetch avoids guessing at it.
 * @param {string} clientId The PayPal app's public client id (from
 * Firestore config.paypalClientId -- the same one already used
 * client-side).
 * @return {Promise<string>} A bearer access token.
 */
async function getPayPalAccessToken(clientId: string): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }

  const basicAuth = Buffer.from(
    `${clientId}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    // A 401 here is nearly always a credential/environment mismatch: three
    // things have to agree and each is provisioned separately - the API host
    // (from GCLOUD_PROJECT), config.paypalClientId, and PAYPAL_CLIENT_SECRET.
    // Getting a live id with a sandbox secret (or the reverse) 401s here and
    // takes the whole storefront down, so name all three in the error rather
    // than leaving a bare "failed". Only the client id's last 6 characters
    // are logged - enough to tell two apps apart, not enough to be a
    // credential - and the secret is never logged.
    throw new Error(
      `Failed to obtain a PayPal access token (HTTP ${response.status}) ` +
      `from ${PAYPAL_API_BASE} using clientId ending ...` +
      `${clientId.slice(-6)} and PAYPAL_CLIENT_SECRET ` +
      `(${process.env.PAYPAL_CLIENT_SECRET ? "set" : "NOT SET"}). ` +
      "A 401 means the id, the secret and the host do not all belong to the " +
      "same PayPal app - check that this project's secret is the LIVE " +
      "credential and config.paypalClientId is the LIVE client id."
    );
  }

  const data = await response.json();
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.value;
}

// Per-warm-instance cache for the client id (same lifetime model as the
// OAuth token cache above). The config collection changes ~never, but the
// uncached read sat on create_paypal_order's critical path - one Firestore
// round trip per checkout, duplicating the read computeOrderPricing had
// already done. Short TTL so a rotated client id still picks up quickly.
let cachedClientId: {value: string; expiresAt: number} | undefined;
const CLIENT_ID_TTL_MS = 5 * 60 * 1000;

/**
 * Reads the PayPal public client id out of Firestore's config collection --
 * the same value impactdisciples-web already reads to mount the client-side
 * PayPal button. Cached per warm instance for a few minutes.
 * @return {Promise<string>} The PayPal client id.
 */
async function getPaypalClientId(): Promise<string> {
  if (cachedClientId && cachedClientId.expiresAt > Date.now()) {
    return cachedClientId.value;
  }
  // Deliberately NOT .limit(1): `config` is treated as a singleton
  // everywhere, but nothing enforces that, and limit(1) returns an arbitrary
  // document when there is more than one. Silently picking the wrong config
  // in production means charging against the wrong PayPal app - read the
  // collection and refuse to guess instead.
  const configSnap = await admin.firestore().collection("config").get();
  if (configSnap.size > 1) {
    throw new Error(
      `Expected a single config document, found ${configSnap.size} ` +
      `(${configSnap.docs.map((d) => d.id).join(", ")}). Refusing to guess ` +
      "which one holds the live paypalClientId - remove the extras."
    );
  }
  const clientId = configSnap.docs[0]?.data()?.paypalClientId;
  if (!clientId) {
    throw new Error(
      "config.paypalClientId is not set in project " +
      `${process.env.GCLOUD_PROJECT ?? "(unknown)"} - checkout cannot start.`
    );
  }
  cachedClientId = {value: clientId, expiresAt: Date.now() + CLIENT_ID_TTL_MS};
  return clientId;
}

/**
 * Trims and length-caps an untrusted string field, mirroring the
 * event-registration endpoints' 100/200-char pattern - these values are
 * persisted to purchases/pending_orders and interpolated into branded
 * receipt emails, so they must not be unbounded.
 * @param {unknown} value The raw client-supplied value.
 * @param {number} max Maximum length to keep.
 * @return {string | undefined} The trimmed/capped string, or undefined for
 * non-strings (ignoreUndefinedProperties drops it from the written doc).
 */
function capString(value: unknown, max: number): string | undefined {
  return typeof value === "string" ?
    value.trim().slice(0, max) :
    undefined;
}

/**
 * Length-caps every string field of a client-supplied address object
 * (Address model: address1/address2/city/state/zip/country - all flat
 * strings). Non-string values pass through untouched; a non-object input
 * comes back undefined.
 * @param {unknown} value The raw billing/shipping address.
 * @return {Record<string, unknown> | undefined} The capped address.
 */
function capAddress(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const capped: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    capped[key.slice(0, 100)] =
      typeof entry === "string" ? entry.trim().slice(0, 200) : entry;
  }
  return capped;
}

/**
 * Sanitizes the client-supplied cart items before pricing: computeOrder-
 * Pricing spreads each input item into the PricedCartItem that lands on
 * the purchase doc, so the free-selection strings (size/color/language/
 * followUpEmailId + each attendee's fields) get the same trim+cap
 * treatment as the customer fields. Item `id` is additionally verified by
 * computeOrderPricing's own existence lookup; unknown extra keys are
 * dropped. Numbers/booleans pass through as-is - the pricing math already
 * ignores anything non-numeric.
 * @param {unknown[]} rawItems The raw request body's cartItems array.
 * @return {Array<Record<string, unknown>>} The capped cart items.
 */
function capCartItems(rawItems: unknown[]): Array<Record<string, unknown>> {
  return rawItems.map((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const attendees = Array.isArray(item.attendees) ?
      item.attendees.slice(0, 200).map((attendee) => {
        if (typeof attendee !== "object" || attendee === null) {
          return attendee;
        }
        const capped: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(attendee)) {
          capped[key.slice(0, 100)] =
            typeof value === "string" ? value.trim().slice(0, 200) : value;
        }
        return capped;
      }) :
      undefined;
    return {
      id: capString(item.id, 200),
      isEvent: item.isEvent === true,
      isEBook: item.isEBook === true,
      isDigitalBook: item.isDigitalBook === true,
      orderQuantity: item.orderQuantity,
      size: capString(item.size, 100),
      color: capString(item.color, 100),
      language: capString(item.language, 100),
      followUpEmailId: capString(item.followUpEmailId, 200),
      attendees,
    };
  });
}

/**
 * Assembles the server-authoritative CheckoutForm-shaped object that
 * ultimately gets written to the "purchases" collection, matching
 * impactdisciples-web's CheckoutForm shape field-for-field so
 * checkout-success.component.ts's existing localStorage-reading contract
 * (and the admin app's Purchases screens) keep working unmodified.
 * @param {Record<string, unknown>} body The raw client request body
 * (customer/address fields only -- price fields are ignored).
 * @param {PricingResult} pricing The server-computed pricing breakdown.
 * @return {Record<string, unknown>} A CheckoutForm-shaped object, not yet
 * carrying receipt/payPalReceipt/dateProcessed. fulfillmentStatus isn't set
 * here either -- onPurchaseFulfillmentEligible (purchase-fulfillment.
 * functions.ts) stamps it after the doc is actually created, same as it
 * does for every other purchase-creation path.
 */
function buildCheckoutForm(
  body: Record<string, unknown>,
  pricing: PricingResult
): Record<string, unknown> {
  return {
    firstName: capString(body.firstName, 100),
    lastName: capString(body.lastName, 100),
    email: capString(body.email, 200),
    phone: capString(body.phone, 100),
    isShippingSameAsBilling: body.isShippingSameAsBilling === true,
    billingAddress: capAddress(body.billingAddress),
    shippingAddress: capAddress(body.shippingAddress),
    cartItems: pricing.cartItems,
    isNewsletter: body.isNewsletter === true,
    // "total" means the pre-discount item subtotal throughout this system
    // (admin's purchases.component.ts fallback helpers, and
    // checkout-success.component.ts#recordAffiliateSale's own
    // totalBeforeDiscount/totalAfterDiscount math both depend on this) --
    // NOT the grand total actually charged. That real charged amount lives
    // on payPalReceipt (paid orders) or is implicitly $0 (free orders,
    // where tax/shipping are also zeroed - see computeOrderPricing).
    total: pricing.subtotal,
    discount: pricing.totalDiscount,
    couponCode: pricing.couponCode,
    couponPercent: pricing.couponPercent,
    // pricing.shippingRate, not body.shippingRate -- zeroed by
    // computeOrderPricing when the order is free (see its own comment).
    // shippingRateId is kept as sent (the full ShipEngine rate object) even
    // on a free order, so fulfillment can still purchase the real label.
    shippingRate: pricing.shippingRate,
    shippingRateId: body.shippingRateId,
    shippingDiscount: pricing.shippingDiscount,
    shippingDiscountReason: pricing.shippingDiscountReason,
    estimatedTaxes: pricing.estimatedTaxes,
    taxRate: pricing.taxRate,
    taxSource: pricing.taxSource,
  };
}

/**
 * Records a coupon/affiliate sale server-side (sweep 2026-08-17). The web
 * client used to write affilliate_sales directly, which meant the
 * collection had to allow anonymous create - letting anyone forge
 * attribution rows. Now the server writes it from the same
 * server-computed checkout form, and the rule is closed. No-op when no
 * coupon was applied.
 * @param {Record<string, unknown>} checkoutForm The server checkout form.
 * @param {string} receiptId The order's receipt/confirmation id.
 * @return {Promise<void>} Resolves when written (or immediately if no coupon).
 */
async function recordAffiliateSale(
  checkoutForm: Record<string, unknown>,
  receiptId: string
): Promise<void> {
  const code = checkoutForm.couponCode;
  if (typeof code !== "string" || code.trim() === "") {
    return;
  }
  const total = typeof checkoutForm.total === "number" ?
    checkoutForm.total : 0;
  const discount = typeof checkoutForm.discount === "number" ?
    checkoutForm.discount : 0;
  await admin.firestore().collection("affilliate_sales").add({
    code,
    date: admin.firestore.Timestamp.now(),
    email: checkoutForm.email ?? "",
    totalBeforeDiscount: total,
    totalAfterDiscount: total - discount,
    receipt: receiptId,
  });
}

/**
 * Builds the `payPalReceipt` value in the shape the admin app's
 * purchases.component.ts already expects (`IClientAuthorizeCallbackData`,
 * the shape ngx-paypal's old client-side onClientAuthorization callback
 * used to hand it: purchase_units[0].amount.{value,breakdown}, top-level
 * status). PayPal's actual `/v2/checkout/orders/{id}/capture` response does
 * NOT have that shape (the captured amount lives at
 * purchase_units[0].payments.captures[0].amount.value instead, with no
 * item_total/tax_total/shipping/discount breakdown at all) - storing it
 * raw made every price/tax/shipping figure the admin UI derives from
 * payPalReceipt come back NaN for a real (non-free) purchase. Reconstructed
 * from the same server-verified numbers already on checkoutForm, since
 * those are exactly what was quoted to PayPal at order-creation time.
 * @param {Record<string, unknown>} checkoutForm The order's own
 * total/discount/estimatedTaxes/shippingRate/shippingDiscount fields.
 * @param {string} orderId The PayPal order id.
 * @param {string | undefined} payerID The PayPal payer id, if provided.
 * @param {string} amount The exact decimal amount PayPal captured.
 * @param {unknown} captureData PayPal's raw capture response, kept
 * alongside for audit/debugging - not read by any UI today.
 * @return {Record<string, unknown>} A payPalReceipt value the existing
 * admin display helpers can read without any change on their side.
 */
function buildPayPalReceipt(
  checkoutForm: Record<string, unknown>,
  orderId: string,
  payerID: string | undefined,
  amount: string,
  captureData: unknown
): Record<string, unknown> {
  // checkoutForm.total IS the pre-discount item subtotal (see
  // buildCheckoutForm's own comment on this) - no reverse-engineering
  // needed, unlike an earlier version of this function that wrongly
  // treated it as the grand total and derived a bogus item_total from it.
  const itemTotal = (checkoutForm.total as number) ?? 0;
  const discount = (checkoutForm.discount as number) ?? 0;
  const estimatedTaxes = (checkoutForm.estimatedTaxes as number) ?? 0;
  const shippingRate = (checkoutForm.shippingRate as number) ?? 0;
  const shippingDiscount = (checkoutForm.shippingDiscount as number) ?? 0;
  const usd = (value: number) =>
    ({currency_code: "USD", value: value.toFixed(2)});

  return {
    orderID: orderId,
    payerID: payerID ?? null,
    status: (captureData as {status?: string})?.status,
    purchase_units: [{
      amount: {
        currency_code: "USD",
        value: amount,
        breakdown: {
          item_total: usd(itemTotal),
          discount: usd(discount),
          tax_total: usd(estimatedTaxes),
          shipping: usd(shippingRate),
          shipping_discount: usd(shippingDiscount),
        },
      },
    }],
    captureDetails: captureData,
  };
}

/**
 * Stamps each cart item with dateProcessed/processedStatus, matching
 * checkout.component.ts#submitRequest()'s own per-item stamping exactly.
 * @param {Array<Record<string, unknown>>} items The order's cart items.
 * @return {void}
 */
function stampCartItems(items: Array<Record<string, unknown>>): void {
  const now = admin.firestore.Timestamp.now();
  items.forEach((item) => {
    item.dateProcessed = now;
    item.processedStatus = "NEW";
  });
}

/**
 * Same 8-hex-character error-code generator as LoggerService
 * (impactdisciples-web/src/app/common/services/data/logger.service.ts),
 * replicated here so a server-side log entry gets the same kind of
 * reference code a support agent already knows how to look up.
 * @return {string} An 8-character hex-like error code.
 */
function generateErrorCode(): string {
  return "xxxxxxxx".replace(/[xy]/g, () => {
    const r = (Math.random() * 16) | 0;
    return r.toString(16);
  });
}

/**
 * Writes a log-messages doc matching LoggerService's own shape, for the one
 * failure mode that must never fail silently: payment already
 * captured/accepted, but the Purchase record itself couldn't be saved. Same
 * "CHECKOUT" type/reasoning as checkout.component.ts#submitRequest()'s own
 * catch block used to log client-side before this write moved server-side.
 * @param {string | undefined} email The buyer's email, if known.
 * @param {string} message What went wrong.
 * @param {unknown} data Extra diagnostic context (error, order id, etc).
 * @return {Promise<string>} The generated error/reference code.
 */
async function logCheckoutFailure(
  email: string | undefined,
  message: string,
  data: unknown
): Promise<string> {
  const errorCode = generateErrorCode();
  try {
    await admin.firestore().collection("log-messages").add({
      id: errorCode,
      date: admin.firestore.Timestamp.now(),
      type: "CHECKOUT",
      created_by: email ?? "unknown",
      message,
      error_code: errorCode,
      archived: false,
      data,
    });
  } catch (err) {
    console.error("Failed to write log-messages entry", err);
  }
  return errorCode;
}

exports.create_paypal_order = functions
  .runWith({secrets: ["PAYPAL_CLIENT_SECRET", "TAX_API_KEY"]})
  .https.onRequest((request, response) => {
    return restrictedCors(request, response, async () => {
      try {
        const body = request.body ?? {};

        if (!Array.isArray(body.cartItems) || body.cartItems.length === 0) {
          response.status(400)
            .send({code: 400, error: "cartItems is required"});
          return;
        }
        if (!body.email || !body.shippingAddress) {
          response.status(400).send({
            code: 400,
            error: "email and shippingAddress are required",
          });
          return;
        }

        // The PayPal OAuth token (client-id read + token round trip) is
        // fetched CONCURRENTLY with pricing - it used to run after it,
        // serially, adding its full latency to every checkout. Free/$0
        // orders resolve a token they don't use; that's a no-op on warm
        // instances (both caches hold) and a negligible cost on cold ones.
        const tokenPromise = getPaypalClientId()
          .then((clientId) => getPayPalAccessToken(clientId));
        // Don't let the free-order early return leave this dangling as an
        // unhandled rejection - the paid path re-awaits it below and gets
        // the real error there.
        tokenPromise.catch(() => undefined);

        const pricing = await computeOrderPricing({
          cartItems: capCartItems(
            body.cartItems
          ) as unknown as PricingCartItemInput[],
          couponCode: body.couponCode,
          shippingAddress: body.shippingAddress,
          shippingRate: body.shippingRate ?? 0,
        });

        const checkoutForm = buildCheckoutForm(body, pricing);

        if (pricing.total <= 0) {
          checkoutForm.receipt = pricing.couponCode ? "COUPON" : "FREE ONLY";
          checkoutForm.dateProcessed = admin.firestore.Timestamp.now();
          stampCartItems(
            pricing.cartItems as unknown as Array<Record<string, unknown>>
          );

          // No payment was taken on this path (it's genuinely free) -- a
          // write failure here just means "order didn't save," safe to
          // report as a normal error and let the customer retry.
          let docRef;
          try {
            docRef = await admin.firestore()
              .collection("purchases").add(checkoutForm);
          } catch (err) {
            console.error("Failed to save free/coupon order", err);
            response.status(400).send({
              code: 400,
              error: "Failed to save your order. Please try again.",
            });
            return;
          }

          // Pre-prod #1: receipt + follow-up emails are queued here now
          // (the client no longer writes `mail`). Best-effort - the order
          // is already saved.
          try {
            await queueWebOrderEmails(admin.firestore(), checkoutForm);
          } catch (err) {
            console.error("Failed to queue order emails (free path)", err);
          }
          // Sweep #: affiliate sale recorded server-side now.
          try {
            await recordAffiliateSale(
              checkoutForm, checkoutForm.receipt as string
            );
          } catch (err) {
            console.error("Failed to record affiliate sale (free)", err);
          }

          response.send({
            free: true,
            checkoutForm: {...checkoutForm, id: docRef.id},
          });
          return;
        }

        const accessToken = await tokenPromise;
        const amountValue = pricing.total.toFixed(2);
        const shippingRateValue = pricing.shippingRate.toFixed(2);

        const itemTotalValue = pricing.subtotal.toFixed(2);
        const shippingDiscountValue = pricing.shippingDiscount.toFixed(2);
        const taxTotalValue = pricing.estimatedTaxes.toFixed(2);
        const discountValue = pricing.totalDiscount.toFixed(2);

        const orderResponse = await fetch(
          `${PAYPAL_API_BASE}/v2/checkout/orders`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              intent: "CAPTURE",
              purchase_units: [{
                amount: {
                  currency_code: "USD",
                  value: amountValue,
                  breakdown: {
                    item_total: {currency_code: "USD", value: itemTotalValue},
                    shipping: {currency_code: "USD", value: shippingRateValue},
                    shipping_discount: {
                      currency_code: "USD",
                      value: shippingDiscountValue,
                    },
                    tax_total: {currency_code: "USD", value: taxTotalValue},
                    discount: {currency_code: "USD", value: discountValue},
                  },
                },
                items: pricing.cartItems.map((item) => ({
                  name: item.itemName || "Item",
                  quantity: String(item.orderQuantity),
                  category: "DIGITAL_GOODS",
                  unit_amount: {
                    currency_code: "USD",
                    value: item.price.toFixed(2),
                  },
                })),
              }],
            }),
          }
        );

        const orderData = await orderResponse.json();

        if (!orderResponse.ok || !orderData.id) {
          console.error("PayPal order creation failed", orderData);
          response.status(400)
            .send({code: 400, error: "Failed to create PayPal order"});
          return;
        }

        await admin.firestore()
          .collection("pending_orders").doc(orderData.id).set({
            status: "created",
            createdAt: admin.firestore.Timestamp.now(),
            capturedAt: null,
            purchaseId: null,
            amount: amountValue,
            currency: "USD",
            checkoutForm,
          });

        response.send({
          free: false,
          orderId: orderData.id,
          breakdown: {
            subtotal: pricing.subtotal,
            totalDiscount: pricing.totalDiscount,
            estimatedTaxes: pricing.estimatedTaxes,
            taxRate: pricing.taxRate,
            taxSource: pricing.taxSource,
            shippingDiscount: pricing.shippingDiscount,
            shippingDiscountReason: pricing.shippingDiscountReason,
            total: pricing.total,
          },
        });
      } catch (err) {
        console.error("create_paypal_order failed", err);
        response.status(400).send(
          {code: 400, error: "Unable to start checkout"});
      }
    });
  });

exports.capture_paypal_order = functions
  .runWith({secrets: ["PAYPAL_CLIENT_SECRET", "TAX_API_KEY"]})
  .https.onRequest((request, response) => {
    return restrictedCors(request, response, async () => {
      try {
        const orderId: string | undefined = request.body?.orderId;
        const payerID: string | undefined = request.body?.payerID;
        if (!orderId) {
          response.status(400).send({code: 400, error: "orderId is required"});
          return;
        }

        const pendingRef = admin.firestore()
          .collection("pending_orders").doc(orderId);
        const pendingSnap = await pendingRef.get();

        if (!pendingSnap.exists) {
          response.status(400).send({code: 400, error: "Unknown orderId"});
          return;
        }

        const pending = pendingSnap.data() as {
          status: string;
          amount: string;
          checkoutForm: Record<string, unknown>;
          purchaseId: string | null;
        };

        // Idempotent replay -- a duplicate authorizeOnServer call (retry,
        // double-click) just returns the already-finalized result instead
        // of double-capturing with PayPal or double-writing a Purchase.
        if (pending.status === "captured" && pending.purchaseId) {
          const purchaseSnap = await admin.firestore()
            .collection("purchases").doc(pending.purchaseId).get();
          response.send({
            checkoutForm: purchaseSnap.exists ?
              {...purchaseSnap.data(), id: purchaseSnap.id} :
              pending.checkoutForm,
          });
          return;
        }

        const clientId = await getPaypalClientId();
        const accessToken = await getPayPalAccessToken(clientId);

        const captureResponse = await fetch(
          `${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}/capture`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${accessToken}`,
            },
          }
        );
        const captureData = await captureResponse.json();

        const capturedUnit = captureData?.purchase_units?.[0];
        const capture = capturedUnit?.payments?.captures?.[0];
        const capturedAmount = capture?.amount?.value;

        // Defense in depth: PayPal order amounts can't change after
        // creation without a re-approval, so this should always match --
        // but never write a Purchase doc without confirming it here rather
        // than trusting a COMPLETED status alone.
        if (!captureResponse.ok || captureData?.status !== "COMPLETED" ||
          capturedAmount !== pending.amount) {
          console.error("PayPal capture failed or amount mismatch", {
            orderId,
            expectedAmount: pending.amount,
            capturedAmount,
            status: captureData?.status,
          });
          response.status(400).send({
            code: 400,
            error: "Payment capture could not be verified",
          });
          return;
        }

        const checkoutForm: Record<string, unknown> = {
          ...pending.checkoutForm,
          receipt: orderId,
          payPalReceipt: buildPayPalReceipt(
            pending.checkoutForm, orderId, payerID, pending.amount, captureData
          ),
          dateProcessed: admin.firestore.Timestamp.now(),
        };
        stampCartItems(
          checkoutForm.cartItems as Array<Record<string, unknown>>
        );

        // Payment has already been captured by this point -- a failure
        // below must never look like "payment failed" to the customer.
        // Same reasoning as the client-side safety net
        // checkout.component.ts#submitRequest() used to carry before this
        // write moved server-side (2026-08-12 fullsweep fix #10): log it
        // with a reference code and tell the truth -- payment went
        // through, recording it hit a problem, here's who to contact.
        try {
          const docRef = await admin.firestore()
            .collection("purchases").add(checkoutForm);

          await pendingRef.update({
            status: "captured",
            capturedAt: admin.firestore.Timestamp.now(),
            purchaseId: docRef.id,
          });

          // Pre-prod #1: receipt + follow-up emails are queued here now
          // (the client no longer writes `mail`). Best-effort - payment
          // is captured and the order is saved. Runs CONCURRENTLY with the
          // affiliate write (they're independent; they used to run
          // serially, and queueWebOrderEmails' own internal per-item
          // template loop made that the slowest part of the customer's
          // "Finishing your order..." wait). Both stay awaited before the
          // response on purpose: on Cloud Functions, work left running
          // after response.send() can be frozen mid-flight and silently
          // lost - a receipt email that never queues is worse than ~a
          // second more spinner.
          await Promise.all([
            queueWebOrderEmails(admin.firestore(), checkoutForm)
              .catch((err) => console.error(
                "Failed to queue order emails (captured path)", err
              )),
            recordAffiliateSale(checkoutForm, orderId)
              .catch((err) => console.error(
                "Failed to record affiliate sale (captured)", err
              )),
          ]);

          response.send({checkoutForm: {...checkoutForm, id: docRef.id}});
        } catch (err) {
          const errorCode = await logCheckoutFailure(
            pending.checkoutForm?.email as string | undefined,
            "Failed to save purchase after PayPal payment was captured.",
            {err: String(err), orderId, capturedAmount}
          );

          await pendingRef.update({status: "captured_unrecorded"})
            .catch(() => undefined);

          response.send({
            recordingFailed: true,
            errorCode,
            payPalOrderId: orderId,
          });
        }
      } catch (err) {
        console.error("capture_paypal_order failed", err);
        response.status(400).send(
          {code: 400, error: "Unable to complete payment"});
      }
    });
  });
