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
  const db = admin.firestore();

  const configSnap = await db.collection("config").limit(1).get();
  const config = configSnap.docs[0]?.data() ?? {};

  const activeSales = await getActiveSales();
  const productSale = activeSales.find((sale) => sale.isProducts);
  const shippingSale = activeSales.find((sale) => sale.isShipping);

  let coupon: admin.firestore.DocumentData | undefined;
  if (request.couponCode) {
    const couponSnap = await db.collection("coupons")
      .where("code", "==", request.couponCode)
      .limit(1)
      .get();
    const candidate = couponSnap.docs[0]?.data();
    if (candidate?.isActive) {
      coupon = candidate;
    }
  }

  const pricedItems: PricedCartItem[] = [];

  for (const input of request.cartItems) {
    const collectionName = input.isEvent ? "events" : "products";
    const docSnap = await db.collection(collectionName).doc(input.id).get();

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

      try {
        const response = await fetch(
          "https://api.apilayer.com/tax_data/tax_rates?zip=" +
            encodeURIComponent(request.shippingAddress.zip ?? "") +
            "&use_client_ip=false&country=US",
          {
            method: "GET",
            headers: {apikey: process.env.TAX_API_KEY ?? ""},
          }
        );
        const data = response.ok ? await response.json() : null;

        taxRate = typeof data?.combined_rate === "number" ?
          data.combined_rate : 0.07;
        taxSource = data ? "service" : "default";
      } catch {
        taxRate = 0.07;
        taxSource = "default";
      }

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
