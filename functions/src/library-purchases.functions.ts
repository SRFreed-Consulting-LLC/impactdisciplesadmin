import {onCall, HttpsError} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import * as admin from "firebase-admin";
import {
  PaypalEnvironment,
  getAccessToken,
  getOrderCapture,
} from "./library-paypal";
import {applyStorePurchaseGrant} from "./library-store-license-grant";

/**
 * verifyAndGrantReaderStorePurchase - the reader app's own StoreComponent
 * checkout, verified server-side end to end:
 *
 * - Pricing is recomputed HERE from the `products` collection (cost/
 *   salePrice) and the coupon's own doc (percentOff + tags scoping,
 *   case-insensitive code match, isActive) - mirroring the reader's
 *   store-pricing.ts math exactly - so a tampered client can neither
 *   invent prices nor forge a coupon. The client's claimed totals are
 *   ignored.
 * - PayPal path: the captured amount/status is confirmed with PayPal and
 *   must match the SERVER-computed total.
 * - No-PayPal path: only legitimate when the server-computed total (with
 *   the verified coupon applied) is exactly $0 - otherwise rejected.
 *
 * On success this writes a purchase record into this project's shared
 * `purchases` collection - the same table the web storefront's checkout
 * writes - per the 2026-08-17 direction that every real sale (coupons
 * included) lands there. That write fans out through the existing
 * purchases triggers: onPurchaseCustomerUpsert (buyer becomes a customer
 * + Mailchimp contact, intentionally), onPurchaseFulfillmentEligible
 * (digital-only carts auto-close), and onPurchaseGrantLibraryLicenses
 * (grants keyed per (bookId, purchaseDocId), so its grant and the direct
 * in-process grant below converge idempotently - the trigger's
 * retry: true doubles as the safety net if this function dies between
 * the doc write and its own grant). Free access paths (admin grants,
 * international patrons) never create purchase records - and therefore
 * never become customers/Mailchimp contacts - by design.
 */
const libraryDb = admin.firestore();

const paypalSandboxSecret = defineSecret("PAYPAL_SANDBOX_CLIENT_SECRET");
const paypalLiveSecret = defineSecret("PAYPAL_LIVE_CLIENT_SECRET");

interface ProductDoc {
  title?: string;
  cost?: number;
  salePrice?: number;
  isActive?: boolean;
  isDigitalBook?: boolean;
  digitalBookId?: string;
  imageUrl?: {url: string; name?: string};
}

interface CouponDoc {
  code?: string;
  isActive?: boolean;
  percentOff?: number | null;
  tags?: {id: string}[];
}

/**
 * Cent-rounding, identical to the reader's store-pricing.ts round2 - the
 * two must agree or a legitimate PayPal charge computed client-side would
 * fail the server-side amount match below.
 * @param {number} value Raw amount.
 * @return {number} Rounded to 2 decimal places.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * salePrice only counts when it's a positive number strictly below cost -
 * mirrors the reader's effectivePrice.
 * @param {ProductDoc} product The product doc's data.
 * @return {number} The price a buyer actually pays before coupons.
 */
function effectivePrice(product: ProductDoc): number {
  const cost = product.cost ?? 0;
  return product.salePrice && product.salePrice > 0 &&
    product.salePrice < cost ?
    product.salePrice :
    cost;
}

/**
 * A coupon with no tags applies to every product; otherwise only to
 * products whose id is tagged - mirrors the reader's couponAppliesTo.
 * @param {CouponDoc} coupon The coupon doc's data.
 * @param {string} productId The product's doc id.
 * @return {boolean} Whether the coupon discounts this product.
 */
function couponAppliesTo(coupon: CouponDoc, productId: string): boolean {
  return !coupon.tags?.length ||
    coupon.tags.some((tag) => tag.id === productId);
}

export const verifyAndGrantReaderStorePurchase = onCall(
  {secrets: [paypalSandboxSecret, paypalLiveSecret], timeoutSeconds: 120},
  async (request) => {
    const email = request.auth?.token.email?.trim().toLowerCase();
    const uid = request.auth?.uid;
    if (!email || !uid) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }

    const {cartItems, couponCode, payPalOrderId, paypalEnvironment} =
      (request.data ?? {}) as {
        cartItems?: {id?: string}[];
        couponCode?: string;
        payPalOrderId?: string;
        paypalEnvironment?: PaypalEnvironment;
      };

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      throw new HttpsError("invalid-argument", "cartItems is required.");
    }
    const productIds = [
      ...new Set(
        cartItems.map((item) =>
          typeof item?.id === "string" ? item.id.trim() : ""
        )
      ),
    ];
    if (productIds.some((id) => !id)) {
      throw new HttpsError(
        "invalid-argument",
        "Every cart item needs a product id."
      );
    }

    // Server-side product truth - price, digitalBookId, active status all
    // come from the product docs, never from the client's claims.
    const productSnaps = await Promise.all(
      productIds.map((id) => libraryDb.collection("products").doc(id).get())
    );
    const products = productSnaps.map((snap, i) => {
      const data = snap.exists ? (snap.data() as ProductDoc) : undefined;
      if (
        !data ||
        data.isActive === false ||
        data.isDigitalBook !== true ||
        !data.digitalBookId
      ) {
        throw new HttpsError(
          "invalid-argument",
          `Product ${productIds[i]} is not an available digital book.`
        );
      }
      return {id: productIds[i], data};
    });

    // Confirm every product's book actually exists - a stale digitalBookId
    // can't be "granted" and silently do nothing forever. A bare book id
    // doesn't say which series it's nested under, so scan the `books`
    // collectionGroup once and match by doc id.
    const knownBookIds = new Set(
      (await libraryDb.collectionGroup("books").get()).docs.map((d) => d.id)
    );
    const missingBooks = products
      .filter((p) => !knownBookIds.has(p.data.digitalBookId!))
      .map((p) => p.id);
    if (missingBooks.length > 0) {
      throw new HttpsError(
        "invalid-argument",
        `Product(s) reference unknown book(s): ${missingBooks.join(", ")}.`
      );
    }

    // Coupon verification - now possible since Phase 4 moved `coupons`
    // into this project's own database. Case-insensitive comparison
    // against every coupon (small collection), same as the reader's own
    // StoreService.findCoupon, since stored codes aren't consistently
    // cased.
    let coupon: CouponDoc | undefined;
    const trimmedCode = (couponCode ?? "").trim();
    if (trimmedCode) {
      const couponsSnap = await libraryDb.collection("coupons").get();
      coupon = couponsSnap.docs
        .map((d) => d.data() as CouponDoc)
        .find(
          (c) =>
            c.isActive === true &&
            (c.code ?? "").toLowerCase() === trimmedCode.toLowerCase()
        );
      if (!coupon) {
        throw new HttpsError(
          "invalid-argument",
          "Invalid or inactive coupon code."
        );
      }
    }

    // Rebuild the line items server-side - mirrors the reader's
    // buildLineItems exactly.
    const lineItems = products.map(({id, data}) => {
      const price = effectivePrice(data);
      const discount =
        coupon && couponAppliesTo(coupon, id) ?
          round2((price * (coupon.percentOff ?? 0)) / 100) :
          0;
      return {
        id,
        title: data.title ?? id,
        cost: data.cost ?? 0,
        salePrice: data.salePrice,
        imageUrl: data.imageUrl,
        digitalBookId: data.digitalBookId!,
        effectivePrice: price,
        discount,
        finalPrice: round2(price - discount),
      };
    });
    const discountTotal = round2(
      lineItems.reduce((sum, item) => sum + item.discount, 0)
    );
    const total = round2(
      lineItems.reduce((sum, item) => sum + item.finalPrice, 0)
    );

    if (payPalOrderId) {
      const env: PaypalEnvironment = paypalEnvironment ?? "live";
      const clientSecret = (
        env === "sandbox" ? paypalSandboxSecret : paypalLiveSecret
      ).value();
      const accessToken = await getAccessToken(env, clientSecret);
      const capture = await getOrderCapture(env, accessToken, payPalOrderId);
      if (capture.status !== "COMPLETED") {
        throw new HttpsError(
          "failed-precondition",
          `PayPal order is not completed (status: ${capture.status}).`
        );
      }
      if (
        capture.currencyCode !== "USD" ||
        Math.abs(capture.amount - total) > 0.01
      ) {
        throw new HttpsError(
          "failed-precondition",
          `PayPal payment (${capture.currencyCode} ${capture.amount}) ` +
            `does not match the computed total ($${total.toFixed(2)}).`
        );
      }
    } else if (total > 0.005) {
      // No PayPal order and the verified pricing isn't free - a forged
      // "free" claim, or a client bug. Either way, no grant.
      throw new HttpsError(
        "failed-precondition",
        `This order totals $${total.toFixed(2)} and requires payment.`
      );
    }

    // Buyer identity fields for the purchase record - same fields the web
    // storefront's checkout collects, best-effort from the patron's own
    // library profile (customer-upsert tolerates their absence).
    const profileSnap = await libraryDb
      .collection("libraryUsers")
      .doc(email)
      .get();
    const profile = profileSnap.exists ?
      (profileSnap.data() as {
          firstName?: string;
          lastName?: string;
          phone?: string;
        }) :
      undefined;

    const now = Date.now();
    const receipt = payPalOrderId ?? (coupon ? "COUPON" : "FREE ONLY");
    const purchaseRef = libraryDb.collection("purchases").doc();

    // The purchase record - written BEFORE the direct grant below so the
    // onPurchaseGrantLibraryLicenses trigger (retry: true) is a safety
    // net if this function dies mid-way; both grants key on this doc's id
    // so they converge idempotently.
    await purchaseRef.set({
      email,
      userId: uid,
      ...(profile?.firstName ? {firstName: profile.firstName} : {}),
      ...(profile?.lastName ? {lastName: profile.lastName} : {}),
      ...(profile?.phone ? {phone: profile.phone} : {}),
      cartItems: lineItems.map((item) => ({
        id: item.id,
        itemName: item.title,
        price: item.cost,
        ...(item.salePrice ? {salePrice: item.salePrice} : {}),
        orderQuantity: 1,
        discount: item.discount,
        discountPrice: item.finalPrice,
        isDigitalBook: true,
        digitalBookId: item.digitalBookId,
        ...(item.imageUrl ? {img: item.imageUrl} : {}),
      })),
      discount: discountTotal,
      total,
      receipt,
      ...(coupon ? {couponCode: trimmedCode} : {}),
      // A Firestore Timestamp, NOT the raw ms number - the admin Purchases
      // list orders by dateProcessed and Firestore sorts mixed types by
      // TYPE (numbers before timestamps), so a number here buries the
      // purchase behind every web-checkout doc, past pagination.
      dateProcessed: admin.firestore.Timestamp.fromMillis(now),
      ...(payPalOrderId ?
        {paypalEnvironment: paypalEnvironment ?? "live"} :
        {}),
    });

    const recipientRef = libraryDb.collection("libraryUsers").doc(email);
    let result: { granted: string[]; skipped: string[] } = {
      granted: [],
      skipped: [],
    };
    await libraryDb.runTransaction(async (transaction) => {
      const snap = await transaction.get(recipientRef);
      result = applyStorePurchaseGrant({
        transaction,
        recipientRef,
        recipientSnap: snap,
        recipientEmail: email,
        books: lineItems.map((item) => ({bookId: item.digitalBookId})),
        purchaseId: purchaseRef.id,
        now,
      });
    });

    return {
      granted: true,
      purchaseId: purchaseRef.id,
      grantedBookIds: result.granted,
      skippedBookIds: result.skipped,
    };
  }
);
