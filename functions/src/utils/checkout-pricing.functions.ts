import * as admin from "firebase-admin";

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
  followUpEmailId?: string;
}

export interface PricedCartItem extends PricingCartItemInput {
  itemName: string;
  price: number;
  salePrice: number;
  discount: number;
  discountPrice: number | null;
  img?: unknown;
  eBookUrl?: unknown;
  weight?: number;
  digitalBookId?: string;
}

export interface PricingRequest {
  cartItems: PricingCartItemInput[];
  couponCode?: string;
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
      "https://api.apilayer.com/tax_data/tax_rates?zip=" +
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
 * Loads every currently-active, currently-in-date-range Sale document.
 * Mirrors product-details.component.ts / checkout.component.ts's own
 * getActiveSales() (isActive == true, then a client-side date-range filter
 * since Firestore can't range-filter on two different fields in one query).
 * @return {Promise<admin.firestore.DocumentData[]>} Active sales today.
 */
async function getActiveSales(): Promise<admin.firestore.DocumentData[]> {
  const snap = await admin.firestore()
    .collection("sales")
    .where("isActive", "==", true)
    .get();

  const today = new Date();

  return snap.docs
    .map((doc) => doc.data())
    .filter((sale) => {
      const start = new Date(sale.startDate);
      const end = new Date(sale.endDate);
      return start.getTime() <= today.getTime() &&
        end.getTime() >= today.getTime();
    });
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

  const db = admin.firestore();

  // These reads (config, active sales, coupon lookup, and every cart
  // item's product/event doc) are independent of one another - fetched in
  // parallel so the public checkout path pays one round trip, not one per
  // read. The pricing logic itself below is unchanged.
  const [configSnap, activeSales, couponSnap, itemSnaps] = await Promise.all([
    db.collection("config").limit(1).get(),
    getActiveSales(),
    request.couponCode ?
      db.collection("coupons")
        .where("code", "==", request.couponCode)
        .limit(1)
        .get() :
      Promise.resolve(undefined),
    Promise.all(request.cartItems.map((input) =>
      db.collection(input.isEvent ? "events" : "products")
        .doc(input.id).get()
    )),
  ]);

  const config = configSnap.docs[0]?.data() ?? {};

  const productSale = activeSales.find((sale) => sale.isProducts);
  const shippingSale = activeSales.find((sale) => sale.isShipping);

  let coupon: admin.firestore.DocumentData | undefined;
  if (couponSnap) {
    const candidate = couponSnap.docs[0]?.data();
    if (candidate?.isActive) {
      coupon = candidate;
    }
  }

  const pricedItems: PricedCartItem[] = [];

  for (const [index, input] of request.cartItems.entries()) {
    const collectionName = input.isEvent ? "events" : "products";
    const docSnap = itemSnaps[index];

    if (!docSnap.exists) {
      throw new Error(`${collectionName} ${input.id} not found`);
    }
    const doc = docSnap.data() as admin.firestore.DocumentData;

    const basePrice = input.isEvent ?
      (doc.costInDollars ?? 0) : (doc.cost ?? 0);

    // A persisted per-product salePrice always applies if set; an active
    // sitewide "isProducts" sale overrides it -- matches
    // product-details.component.ts#checkProductForSale() precedence
    // exactly. Events have no sale/coupon path at all today (SaleModel's
    // isEvents flag is never read client-side), so this deliberately
    // doesn't invent one.
    let effectiveSalePrice = !input.isEvent && doc.salePrice > 0 ?
      round2(doc.salePrice) : 0;
    if (!input.isEvent && productSale) {
      const percentOff = clampPercent(productSale.percentOff);
      effectiveSalePrice = round2(basePrice - (percentOff / 100 * basePrice));
    }
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
      digitalBookId: doc.digitalBookId,
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

    if (subtotal > freeShippingAmount) {
      shippingDiscount = shippingRate;
      shippingDiscountReason = "Over $" + config.freeShippingAmount;
    } else if (shippingSale) {
      const shippingPercentOff = clampPercent(shippingSale.percentOff);
      shippingDiscount = round2(shippingPercentOff / 100 * shippingRate);
      shippingDiscountReason = shippingPercentOff + "% Off";
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
