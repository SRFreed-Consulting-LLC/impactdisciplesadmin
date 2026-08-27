import {DocumentData, getFirestore} from "firebase-admin/firestore";
import {
  bestOfferPrice,
  getActiveOffers,
  grantsFreeShipping,
} from "./campaign-offers.functions";
import {resolveVendorBase} from "./vendor-hosts";
import {isEventRegistrationOpen, isProductSellable} from "./sellable";
import {pickActiveCoupon} from "./coupons";

// Shared server-side recompute logic for store checkout, used by both
// create_paypal_order and capture_paypal_order (../paypal.functions.ts).
// This mirrors impactdisciples-web's checkout.component.ts /
// product-details.component.ts / shopping-cart.component.ts /
// tax-rate.service.ts client-side math on purpose -- the point of this
// module is to stop *trusting* that math from an untrusted client, not to
// redesign it, so behavior (including a couple of pre-existing quirks
// called out inline below) is replicated deliberately rather than quietly
// changed here.

export interface PricingCartItemInput {
  id: string;
  isEvent?: boolean;
  isEBook?: boolean;
  isDigitalBook?: boolean;
  orderQuantity: number;
  size?: string;
  color?: string;
  language?: string;
  attendees?: unknown[];
}

export interface PricedCartItem extends PricingCartItemInput {
  itemName: string;
  price: number;
  salePrice: number;
  /**
   * Read from the PRODUCT doc, never from the client - it decides whether a
   * series-targeted offer covers this line, including for free shipping.
   */
  series?: string | null;
  discount: number;
  discountPrice: number | null;
  img?: unknown;
  eBookUrl?: unknown;
  weight?: number;
  digitalBookId?: string;
  /**
   * Read from the PRODUCT doc, never from the client - it names the
   * mail_template a purchase sends after checkout, and the gated content
   * those templates can carry (a private video link, a download) is exactly
   * why the buyer must not get to choose which one arrives.
   *
   * Deliberately NOT on PricingCartItemInput: while it sat there, it rode
   * through the `...input` spread below and any checkout request could name
   * any mail_templates doc id and be sent that template. Keeping the two
   * interfaces apart makes reading a client-supplied value a compile error
   * rather than a review catch.
   */
  followUpEmailId?: string | null;
}

export interface PricingRequest {
  cartItems: PricingCartItemInput[];
  couponCode?: string;
  /**
   * The campaign the buyer arrived through, when there is one. Only offers
   * that REQUIRE attribution consult it - the event early-bird rule - but it
   * is re-derived here rather than trusted from a price the client sent.
   */
  attributedCampaignId?: string | null;
  shippingAddress: {state?: string; zip?: string; [key: string]: unknown};
  shippingRate: number;
}

export interface PricingResult {
  cartItems: PricedCartItem[];
  subtotal: number;
  totalDiscount: number;
  estimatedTaxes: number;
  taxRate: number;
  taxSource: string;
  shippingRate: number;
  shippingDiscount: number;
  shippingDiscountReason: string;
  total: number;
  couponCode?: string;
  couponPercent?: number;
}

/**
 * Clamps a percent-off value to 0-100, treating anything non-numeric as 0.
 * Mirrors impactdisciples-web's NumberUtil.clampPercent exactly (same
 * defense-in-depth reasoning: a bad Coupon/Sale record degrades to "no
 * discount" rather than a negative price).
 * @param {unknown} value The raw percentOff field from a coupon/sale doc.
 * @return {number} A value between 0 and 100.
 */
function clampPercent(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

/**
 * Rounds a number to 2 decimal places, matching every ".toFixed(2)" call
 * scattered through the client-side pricing math this replaces.
 * @param {number} value The value to round.
 * @return {number} The value rounded to 2 decimal places.
 */
function round2(value: number): number {
  return Number(value.toFixed(2));
}

// Per-warm-instance cache of apilayer Georgia tax-rate lookups by zip.
// The live lookup sat uncached and untimed on create_paypal_order's
// critical path - a slow apilayer response directly delayed the PayPal
// buttons for every Georgia order. Rates change ~yearly; 12h is generous.
const taxRateCache = new Map<string, {
  taxRate: number; taxSource: string; expiresAt: number;
}>();
const TAX_RATE_TTL_MS = 12 * 60 * 60 * 1000;
const TAX_LOOKUP_TIMEOUT_MS = 3000;

/**
 * Georgia tax rate for a zip via apilayer, with a per-instance 12h cache
 * and a hard timeout - on any failure or slow response it falls back to
 * the same 7% default the uncached code used. Only successful service
 * responses are cached (a cached fallback would stick the default for
 * 12h even after apilayer recovers).
 * @param {string} zip The shipping zip code.
 * @return {Promise<{taxRate: number, taxSource: string}>} Rate + source.
 */
async function lookupGeorgiaTaxRate(
  zip: string
): Promise<{taxRate: number; taxSource: string}> {
  const cached = taxRateCache.get(zip);
  if (cached && cached.expiresAt > Date.now()) {
    return {taxRate: cached.taxRate, taxSource: cached.taxSource};
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(), TAX_LOOKUP_TIMEOUT_MS
    );
    const response = await fetch(
      resolveVendorBase("tax", "https://api.apilayer.com") +
        "/tax_data/tax_rates?zip=" +
        encodeURIComponent(zip) +
        "&use_client_ip=false&country=US",
      {
        method: "GET",
        headers: {apikey: process.env.TAX_API_KEY ?? ""},
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    const data = response.ok ? await response.json() : null;

    if (typeof data?.combined_rate === "number") {
      const result = {taxRate: data.combined_rate, taxSource: "service"};
      taxRateCache.set(zip, {
        ...result, expiresAt: Date.now() + TAX_RATE_TTL_MS,
      });
      return result;
    }
    return {taxRate: 0.07, taxSource: "default"};
  } catch {
    return {taxRate: 0.07, taxSource: "default"};
  }
}

/**
 * Recomputes an order's full price/discount/tax/shipping-discount breakdown
 * server-side from real Firestore data. The client-supplied cartItems only
 * ever carry item ids, quantities, and selections (size/color/language/
 * attendees) -- never prices -- so nothing here trusts anything the client
 * says about cost. Throws if a referenced product/event doesn't exist,
 * rather than silently pricing it at 0.
 * @param {PricingRequest} request The untrusted client request body.
 * @return {Promise<PricingResult>} The server-verified pricing breakdown.
 */
export async function computeOrderPricing(
  request: PricingRequest
): Promise<PricingResult> {
  // Reject any cart item with a non-integer, non-positive, or absurdly
  // large quantity before doing any pricing math or even fetching product
  // data. Previously unvalidated: a negative orderQuantity (e.g. -1) makes
  // `subtotal` negative, which collapses `itemsTotal`/`total` to exactly 0
  // below, which skips PayPal entirely (see create_paypal_order's
  // `pricing.total <= 0` branch) and writes a real, verified-looking
  // Purchase record for a real product/event/digital-book with no payment
  // at all -- the server never re-derives quantity from anything else, so
  // it has to be validated here as untrusted input, same as every other
  // numeric field a client supplies. 1000 is a generous sanity cap, not a
  // real business limit -- large enough for any plausible bulk order,
  // small enough to reject clearly abusive/malformed input.
  const MAX_ORDER_QUANTITY = 1000;
  for (const item of request.cartItems) {
    if (
      typeof item.orderQuantity !== "number" ||
      !Number.isInteger(item.orderQuantity) ||
      item.orderQuantity < 1 ||
      item.orderQuantity > MAX_ORDER_QUANTITY
    ) {
      throw new Error(`Invalid orderQuantity for item ${item.id}`);
    }
  }

  // shippingRate is trusted as a real-time quote from get_shipping_rates
  // by explicit scope decision (see below), but must still be a
  // non-negative finite number -- an unvalidated negative value would
  // otherwise reduce the computed total below the real item cost, the
  // same class of issue as orderQuantity above.
  if (
    typeof request.shippingRate !== "number" ||
    !Number.isFinite(request.shippingRate) ||
    request.shippingRate < 0
  ) {
    throw new Error("Invalid shippingRate");
  }

  const db = getFirestore();

  // These reads (config, active sales, coupon lookup, and every cart
  // item's product/event doc) are independent of one another - fetched in
  // parallel so the public checkout path pays one round trip, not one per
  // read. The pricing logic itself below is unchanged.
  const [configSnap, activeOffers, couponSnap, itemSnaps] = await Promise.all([
    db.collection("config").limit(1).get(),
    getActiveOffers(),
    request.couponCode ?
      db.collection("coupons").get() :
      Promise.resolve(undefined),
    Promise.all(request.cartItems.map((input) =>
      db.collection(input.isEvent ? "events" : "products")
        .doc(input.id).get()
    )),
  ]);

  const config = configSnap.docs[0]?.data() ?? {};

  // The sales collection is retired (Campaign Manager v3). Every discount,
  // including free shipping, now comes from a campaign offer.
  const now = Date.now();
  const attributedCampaignId = request.attributedCampaignId ?? null;

  // The whole (small) collection is scanned rather than queried by code
  // equality: stored codes aren't consistently cased, so there is no
  // canonical form to query by, and `limit(1)` picked arbitrarily between
  // duplicates. See pickActiveCoupon in ./coupons. The read still rides in
  // the Promise.all above, so this is the same single round trip.
  let coupon: DocumentData | undefined;
  if (couponSnap) {
    coupon = pickActiveCoupon(
      couponSnap.docs.map((d) => d.data()),
      request.couponCode
    );
  }

  const pricedItems: PricedCartItem[] = [];

  for (const [index, input] of request.cartItems.entries()) {
    const collectionName = input.isEvent ? "events" : "products";
    const docSnap = itemSnaps[index];

    if (!docSnap.exists) {
      throw new Error(`${collectionName} ${input.id} not found`);
    }
    const doc = docSnap.data() as DocumentData;

    // A delisted product / closed event must not be sellable to someone
    // holding a direct link or a stale cart. The public listings already
    // filter on isActive, but a filter on a LIST is not a boundary - the cart
    // addresses items by id. See utils/sellable.ts for why the product rule is
    // strict and the event rule is not (early-bird registration depends on the
    // latter). Thrown like the not-found case above, which the caller turns
    // into a generic checkout failure.
    const sellable = input.isEvent ?
      isEventRegistrationOpen(doc) :
      isProductSellable(doc);
    if (!sellable) {
      throw new Error(
        `${collectionName} ${input.id} is not available for purchase`
      );
    }

    const basePrice = input.isEvent ?
      (doc.costInDollars ?? 0) : (doc.cost ?? 0);

    // Campaign Manager v3: a discount comes from a campaign offer that names
    // this product, its series, or this event - resolved HERE, server-side,
    // from the campaign_offers collection. The client sends no price at all
    // (capCartItems strips them), so this is the only thing that decides what
    // a card is charged.
    //
    // Events are priced the same way now. They previously had no discount path
    // at all, which is what the early-bird offer needed.
    //
    // A stored product salePrice is NOT consulted any more: campaigns own
    // discounts, the field is a computed display value, and every stored value
    // was cleared by scripts/clear-product-sale-prices.js.
    const bestPrice = bestOfferPrice(
      activeOffers,
      input.isEvent ?
        {kind: "event", id: input.id} :
        {kind: "product", id: input.id, series: doc.series ?? null},
      basePrice,
      now,
      attributedCampaignId
    );
    const effectiveSalePrice = bestPrice !== null && bestPrice < basePrice ?
      round2(bestPrice) : 0;
    const isOnSale = effectiveSalePrice > 0;
    // Rounded once, here, and used everywhere downstream (subtotal, taxable
    // amount, and the per-item unit_amount sent to PayPal) so nothing can
    // drift by a cent between this and the order total PayPal is asked to
    // validate against the sum of its own item/breakdown amounts.
    const effectivePrice = isOnSale ? effectiveSalePrice : round2(basePrice);

    // A coupon only ever discounts an item that isn't already on sale --
    // matches shopping-cart.component.ts#applyCoupon()'s "if (!item.salePrice)"
    // guard exactly (sale always wins over coupon).
    let discount = 0;
    let discountPrice: number | null = null;
    if (coupon && !isOnSale) {
      const tags = coupon.tags as {id?: string}[] | undefined;
      const couponApplies = !tags || tags.length === 0 ||
        tags.some((tag) => tag.id === input.id);
      if (couponApplies) {
        discount = round2(
          effectivePrice * clampPercent(coupon.percentOff) / 100
        );
        discountPrice = round2(effectivePrice - discount);
      }
    }

    pricedItems.push({
      ...input,
      itemName: doc.title ?? "",
      price: effectivePrice,
      salePrice: isOnSale ? round2(effectiveSalePrice) : 0,
      discount,
      discountPrice,
      img: doc.imageUrl,
      eBookUrl: doc.eBookUrl,
      weight: input.isEvent ? 0 : (doc.weight ?? 0),
      series: input.isEvent ? null : (doc.series ?? null),
      digitalBookId: doc.digitalBookId,
      // The admin's choice on the PRODUCT record is the only source, and
      // `sendFollowUpEmail` is honoured here rather than only in the web
      // client - otherwise turning the toggle off in admin does not stop a
      // request that names the template directly. Events never take this
      // path: their confirmation is resolved by `emailTemplate` NAME in
      // event-registration.functions.ts, not by a template doc id.
      followUpEmailId: !input.isEvent && doc.sendFollowUpEmail &&
        doc.followUpEmailId ? (doc.followUpEmailId as string) : null,
    });
  }

  const subtotal = round2(
    pricedItems.reduce((sum, item) => sum + item.price * item.orderQuantity, 0)
  );
  const totalDiscount = round2(
    pricedItems.reduce(
      (sum, item) => sum + (item.discount || 0) * item.orderQuantity, 0
    )
  );
  // What the items themselves cost after discount/sale, before tax and
  // shipping - the number that decides whether this is a free order at all.
  const itemsTotal = round2(subtotal - totalDiscount);

  let estimatedTaxes = 0;
  let taxRate = 0;
  let taxSource = "none";
  let shippingDiscount = 0;
  let shippingDiscountReason = "";
  let shippingRate = request.shippingRate ?? 0;

  // Business rule: an order that's already free after discount is never
  // charged tax or shipping either, and skips PayPal entirely (see
  // create_paypal_order's total <= 0 branch) - so there's nothing to
  // compute here (also saves a live apilayer tax-rate lookup on every free
  // order). Both blocks below are gated on this rather than on the final
  // total, since computing tax/shipping first and only checking the grand
  // total afterward would let a coupon-covered item still get charged for
  // tax/shipping on top of being "free."
  if (itemsTotal > 0) {
    // Tax: only for Georgia shipping addresses (hardcoded client-side
    // today, replicated as-is, not "fixed" here). Taxable amount is the
    // pre-coupon-discount, sale-adjusted price on non-event items -- matches
    // tax-rate.service.ts's own math exactly, including its pre-existing
    // "not coupon-discount-aware" quirk. The apilayer key comes from Secret
    // Manager (TAX_API_KEY). It was previously read by the browser, then
    // moved to this Firestore config doc - which closed the bundle exposure
    // but not the real one, since firestore.rules leaves `config` readable to
    // anyone holding the public Firebase config. Same reasoning as
    // MailchimpConfigModel's: a key in Firestore is a public key.
    if (request.shippingAddress?.state === "Georgia") {
      const taxableAmount = round2(
        pricedItems
          .filter((item) => !item.isEvent)
          .reduce((sum, item) => sum + item.price * item.orderQuantity, 0)
      );

      const rate = await lookupGeorgiaTaxRate(
        request.shippingAddress.zip ?? ""
      );
      taxRate = rate.taxRate;
      taxSource = rate.taxSource;

      estimatedTaxes = round2(taxableAmount * taxRate);
    }

    // Shipping discount: the rate itself is trusted as sent by the client
    // (it already came from the real get_shipping_rates/ShipEngine function
    // earlier in the flow, by explicit scope decision) -- only the discount
    // applied on top of it is re-verified here, matching
    // checkout.component.ts#calculateShippingCost() exactly.
    const freeShippingAmount = typeof config.freeShippingAmount === "number" ?
      config.freeShippingAmount : Infinity;

    // Two rules can free shipping - the spend threshold and a campaign offer
    // - so take the BEST for the buyer rather than the first that matches.
    // Mirrors the storefront's bestShippingDiscount().
    const candidates: {amount: number; reason: string}[] = [];

    if (subtotal > freeShippingAmount) {
      candidates.push({
        amount: shippingRate,
        reason: "Over $" + config.freeShippingAmount,
      });
    }

    // Order-level grant: the cart holding one covered product frees shipping
    // on the whole order, because shipping is quoted once per order.
    const campaignFreeShipping = pricedItems.some((item) =>
      !item.isEvent && grantsFreeShipping(
        activeOffers,
        {kind: "product", id: item.id, series: item.series ?? null},
        now,
        attributedCampaignId
      ));
    if (campaignFreeShipping) {
      candidates.push({amount: shippingRate, reason: "Free shipping offer"});
    }


    const best = candidates.sort((a, b) => b.amount - a.amount)[0];
    if (best && best.amount > 0) {
      shippingDiscount = best.amount;
      shippingDiscountReason = best.reason;
    }
  } else {
    shippingRate = 0;
  }

  const total = itemsTotal > 0 ?
    round2(itemsTotal + estimatedTaxes + shippingRate - shippingDiscount) : 0;

  return {
    cartItems: pricedItems,
    subtotal,
    totalDiscount,
    estimatedTaxes,
    taxRate,
    taxSource,
    shippingRate,
    shippingDiscount,
    shippingDiscountReason,
    total,
    couponCode: coupon ? request.couponCode : undefined,
    couponPercent: coupon ? clampPercent(coupon.percentOff) : undefined,
  };
}
