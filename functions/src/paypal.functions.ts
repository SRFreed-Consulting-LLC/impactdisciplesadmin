import {tenantPath} from "./common/shared/lists/tenancy";
const PENDING_ORDERS = tenantPath("pending_orders");
const LOG_MESSAGES = tenantPath("log-messages");
const AFFILIATE_SALES = tenantPath("affilliate_sales");
const PURCHASES = tenantPath("purchases");
import {onRequest} from "firebase-functions/v2/https";
import {Timestamp, getFirestore} from "firebase-admin/firestore";
import {restrictedCors} from "./utils/security.functions";
import {PAYPAL_CLIENT_SECRET, TAX_API_KEY} from "./utils/secrets";
import {readTenantConfig} from "./utils/tenant-config";
import {queueWebOrderEmails} from "./transactional-emails";
import {
  campaignForCoupon,
  recordCampaignConversion,
  sanitizeAttribution,
} from "./campaign-tracking.functions";
import {
  computeOrderPricing,
  PricingCartItemInput,
  PricingResult,
} from "./utils/checkout-pricing.functions";
import {
  CreatePaypalOrderRequest,
} from "./common/shared/contract/web-http.types";
import {PURCHASE_SOURCE_WEB} from "./purchase-source";
import {
  getAccessTokenWithCredentials,
  paypalApiBase,
  resolvePaypalEnvironment,
} from "./library-paypal";

// Server-side counterpart to impactdisciples-web's checkout.component.ts.
// Two public HTTP functions (no requireStaffAuth -- anonymous storefront
// checkout must be able to call these): create_paypal_order recomputes the
// real order
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

// Which PayPal environment this deployment transacts against, and the REST
// host that goes with it. Both come from the shared client
// (library-paypal.ts) rather than a second local copy of the same
// GCLOUD_PROJECT switch and host map - two copies is exactly how a live
// token ends up being sent to the sandbox host. The web storefront is a
// DIFFERENT PayPal app from the library/reader one, which is why the client
// id below is read from Firestore config instead of that module's
// hardcoded map.
const PAYPAL_ENV = resolvePaypalEnvironment();
// A function, not a const: the base URL is resolved per request so an
// emulator run can redirect PayPal at the fake vendor server without a cold
// start (utils/vendor-hosts.ts). The environment itself still comes from
// GCLOUD_PROJECT once, at load, exactly as before - that must never be
// per-request, and never client-influenced.
const paypalApiBaseUrl = () => paypalApiBase(PAYPAL_ENV);

/**
 * Obtains (and short-term caches, per warm function instance) a PayPal
 * OAuth2 access token for the WEB STOREFRONT's PayPal app. Thin wrapper over
 * the shared client so this app's credentials - a Firestore-held client id
 * plus the PAYPAL_CLIENT_SECRET Secret Manager secret - stay in one place;
 * the retry/backoff, the token cache and the detailed 401 diagnostics all
 * live in library-paypal.ts now.
 * @param {string} clientId The PayPal app's public client id (from
 * Firestore config.paypalClientId -- the same one already used
 * client-side).
 * @return {Promise<string>} A bearer access token.
 */
function getPayPalAccessToken(clientId: string): Promise<string> {
  return getAccessTokenWithCredentials(
    PAYPAL_ENV, clientId, PAYPAL_CLIENT_SECRET.value()
  );
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
  // readTenantConfig refuses to guess between two config documents -
  // silently picking the wrong one here means charging against the wrong
  // PayPal app. That rule started in this function and is shared now.
  const clientId = (await readTenantConfig(getFirestore()))?.paypalClientId;
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
 * the purchase doc, so the free-selection strings (size/color/language +
 * each attendee's fields) get the same trim+cap treatment as the customer
 * fields. Item `id` is additionally verified by computeOrderPricing's own
 * existence lookup; unknown extra keys are dropped. Numbers/booleans pass
 * through as-is - the pricing math already ignores anything non-numeric.
 *
 * `followUpEmailId` is deliberately NOT forwarded (2026-08-27). It is not a
 * buyer selection - it names the mail_template the purchase sends, so
 * computeOrderPricing now reads it from the product doc instead. Forwarding
 * it let any request be mailed any template, gated content included.
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
    // NORMALIZED, not merely length-capped. This address is the join key
    // between a purchase and its customer record, and every reader of it
    // already lowercases before looking up: both customer-upsert triggers,
    // and contact-details.component.ts, which streams a contact's activity
    // feed with an exact where("email", "==", customer.email). Storing what
    // the shopper typed meant a purchase from "Dgpark@hotmail.com" never
    // appeared under the contact "dgpark@hotmail.com" - 355 customers had
    // orders silently missing from their feed before this was fixed
    // (2026-08-27). The public RSVP path (event-registration.functions.ts)
    // and every reader path already normalize; this was the odd one out.
    // One funnel covers three writes: both purchase creates, the affiliate
    // sale (recordAffiliateSale reads checkoutForm.email), and the
    // pending_orders staging doc.
    email: capString(body.email, 200)?.toLowerCase(),
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
    // Campaign attribution (Campaign Manager v2, Phase 4) - captured on
    // the public site from campaign-link ?cid/&ceid params, validated/
    // length-capped here, credited only after the purchase actually saves
    // (see recordPurchaseAttribution).
    attribution: sanitizeAttribution(body.attribution),
  };
}

/**
 * Credits a saved purchase to its campaign (Campaign Manager v2 funnel):
 * explicit link/popup attribution wins; otherwise a coupon code matching
 * a live campaign's couponId attributes via 'coupon'. Best-effort - never
 * fails the order.
 * @param {Record<string, unknown>} checkoutForm The SAVED checkout form.
 * @param {string} orderId Receipt/PayPal order id.
 * @param {number} amount The charged amount in dollars (0 for free).
 * @return {Promise<void>} Resolves when recorded (or skipped).
 */
async function recordPurchaseAttribution(
  checkoutForm: Record<string, unknown>,
  orderId: string,
  amount: number
): Promise<void> {
  const db = getFirestore();
  const attribution = checkoutForm.attribution as
    {campaignId: string; emailId?: string; source?: string} | null;
  if (attribution?.campaignId) {
    await recordCampaignConversion(db, {
      campaignId: attribution.campaignId,
      emailId: attribution.emailId,
      type: "purchase",
      via: attribution.source === "popup" ? "popup" : "link",
      amount,
      orderId,
      email: checkoutForm.email as string,
    });
    return;
  }
  const couponCampaignId = await campaignForCoupon(
    db, checkoutForm.couponCode as string);
  if (couponCampaignId) {
    await recordCampaignConversion(db, {
      campaignId: couponCampaignId,
      type: "purchase",
      via: "coupon",
      amount,
      orderId,
      email: checkoutForm.email as string,
    });
  }
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
  await getFirestore().collection(AFFILIATE_SALES).add({
    code,
    date: Timestamp.now(),
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
  const now = Timestamp.now();
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
    await getFirestore().collection(LOG_MESSAGES).add({
      id: errorCode,
      date: Timestamp.now(),
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

exports.create_paypal_order = onRequest(
  {secrets: [PAYPAL_CLIENT_SECRET, TAX_API_KEY]},
  (request, response) => {
    return restrictedCors(request, response, async () => {
      try {
        const body =
          (request.body ?? {}) as Partial<CreatePaypalOrderRequest>;

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
          // The campaign the buyer arrived through, sanitized the same way
          // the purchase record's own attribution is. Only offers that
          // REQUIRE it consult it - the event early-bird rule - and the price
          // is re-derived from the offer rather than taken from the client.
          attributedCampaignId:
            sanitizeAttribution(body.attribution)?.campaignId ?? null,
          shippingAddress: body.shippingAddress as
            {state?: string; zip?: string; [key: string]: unknown} | undefined,
          shippingRate: body.shippingRate ?? 0,
        });

        const checkoutForm = buildCheckoutForm(body, pricing);

        if (pricing.total <= 0) {
          // The receipt IS the coupon code on a coupon-covered order (owner,
          // 2026-09-03) - it used to be the literal "COUPON", with the code
          // beside it in couponCode. couponCode is still written for every
          // coupon order (a paid order with a partial coupon has a PayPal id
          // here and the code only there); the Purchases grid just no longer
          // shows it. scripts/backfill-coupon-receipts.js moved the old rows.
          checkoutForm.receipt = pricing.couponCode ?? "FREE ONLY";
          checkoutForm.dateProcessed = Timestamp.now();
          stampCartItems(
            pricing.cartItems as unknown as Array<Record<string, unknown>>
          );

          // No payment was taken on this path (it's genuinely free) -- a
          // write failure here just means "order didn't save," safe to
          // report as a normal error and let the customer retry.
          let docRef;
          try {
            docRef = await getFirestore()
              .collection(PURCHASES)
              .add({...checkoutForm, source: PURCHASE_SOURCE_WEB});
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
            await queueWebOrderEmails(getFirestore(), checkoutForm);
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
          // Best-effort like its two siblings above. Without this catch a
          // rejection here (recordCampaignConversion / campaignForCoupon both
          // do real I/O) fell to the outer catch and answered
          // 400 "Unable to start checkout" - after the purchase doc was
          // written and the receipt queued. The shopper reads that as failure
          // and orders again, so the visible symptom is duplicate free orders.
          try {
            await recordPurchaseAttribution(
              checkoutForm, checkoutForm.receipt as string, 0);
          } catch (err) {
            console.error("Failed to record purchase attribution (free)", err);
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
          `${paypalApiBaseUrl()}/v2/checkout/orders`,
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

        await getFirestore()
          .collection(PENDING_ORDERS).doc(orderData.id).set({
            status: "created",
            createdAt: Timestamp.now(),
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

exports.capture_paypal_order = onRequest(
  {secrets: [PAYPAL_CLIENT_SECRET, TAX_API_KEY]},
  (request, response) => {
    return restrictedCors(request, response, async () => {
      try {
        const orderId: string | undefined = request.body?.orderId;
        const payerID: string | undefined = request.body?.payerID;
        if (!orderId) {
          response.status(400).send({code: 400, error: "orderId is required"});
          return;
        }

        const pendingRef = getFirestore()
          .collection(PENDING_ORDERS).doc(orderId);
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
          const purchaseSnap = await getFirestore()
            .collection(PURCHASES).doc(pending.purchaseId).get();
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
          `${paypalApiBaseUrl()}/v2/checkout/orders/${orderId}/capture`,
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
          dateProcessed: Timestamp.now(),
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
          const docRef = await getFirestore()
            .collection(PURCHASES)
            .add({...checkoutForm, source: PURCHASE_SOURCE_WEB});

          await pendingRef.update({
            status: "captured",
            capturedAt: Timestamp.now(),
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
            queueWebOrderEmails(getFirestore(), checkoutForm)
              .catch((err) => console.error(
                "Failed to queue order emails (captured path)", err
              )),
            recordAffiliateSale(checkoutForm, orderId)
              .catch((err) => console.error(
                "Failed to record affiliate sale (captured)", err
              )),
            // Same best-effort contract as the two above, and it matters most
            // here: PayPal has already taken the money and the purchase doc
            // is written. An unguarded rejection flipped pendingRef to
            // captured_unrecorded and answered {recordingFailed: true},
            // telling the customer and support the order was NOT recorded
            // when it was - the one outcome the comment above says must never
            // happen.
            recordPurchaseAttribution(
              checkoutForm, orderId, Number(pending.amount) || 0)
              .catch((err) => console.error(
                "Failed to record purchase attribution (captured)", err
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
