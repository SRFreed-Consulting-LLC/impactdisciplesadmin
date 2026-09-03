import {tenantPath} from "./common/shared/lists/tenancy";
const COUPONS = tenantPath("coupons");
const PRODUCTS = tenantPath("products");
const PURCHASES = tenantPath("purchases");
const LIBRARY_USERS = tenantPath("libraryUsers");
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {PURCHASE_SOURCE_READER} from "./purchase-source";
import {defineSecret} from "firebase-functions/params";
import {Timestamp, getFirestore} from "firebase-admin/firestore";
import {
  getAccessToken,
  getOrderCapture,
  resolvePaypalEnvironment,
} from "./library-paypal";
import {applyStorePurchaseGrant} from "./library-store-license-grant";
import {
  CouponDoc,
  couponAppliesToProduct,
  pickActiveCoupon,
} from "./utils/coupons";
import {
  assertCaptureMatchesTotal,
  findPriorPurchaseByReceipt,
  isEffectivelyFree,
} from "./utils/capture-verify";
import {ProductDoc, round2, effectivePrice} from "./library-store-pricing";
import {queueReaderReceiptEmail} from "./transactional-emails";
import {
  VerifyAndGrantReaderStorePurchaseResult,
} from "./common/shared/contract/library-callables.types";

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
const libraryDb = getFirestore();

const paypalSandboxSecret = defineSecret("PAYPAL_SANDBOX_CLIENT_SECRET");
const paypalLiveSecret = defineSecret("PAYPAL_LIVE_CLIENT_SECRET");

export const verifyAndGrantReaderStorePurchase = onCall(
  {secrets: [paypalSandboxSecret, paypalLiveSecret], timeoutSeconds: 120},
  async (request): Promise<VerifyAndGrantReaderStorePurchaseResult> => {
    const email = request.auth?.token.email?.trim().toLowerCase();
    const uid = request.auth?.uid;
    if (!email || !uid) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }

    const {cartItems, couponCode, payPalOrderId} =
      (request.data ?? {}) as {
        cartItems?: {id?: string}[];
        couponCode?: string;
        payPalOrderId?: string;
      };
    // Server-authoritative, NOT from request.data (a client-chosen value
    // would let a sandbox capture satisfy a live grant - fake money for
    // real books). See resolvePaypalEnvironment.
    const env = resolvePaypalEnvironment();

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
      productIds.map((id) => libraryDb.collection(PRODUCTS).doc(id).get())
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
      // digitalBookId is confirmed truthy by the guard above -- carrying
      // that as part of the returned type (rather than asserting `!` again
      // at every later usage site below) keeps the "trust point" to
      // exactly where it's actually validated.
      return {
        id: productIds[i],
        data: data as ProductDoc & {digitalBookId: string},
      };
    });

    // Confirm every product's book actually exists - a stale digitalBookId
    // can't be "granted" and silently do nothing forever. A bare book id
    // doesn't say which series it's nested under, so scan the `books`
    // collectionGroup once and match by doc id.
    const knownBookIds = new Set(
      (await libraryDb.collectionGroup("books").get()).docs.map((d) => d.id)
    );
    const missingBooks = products
      .filter((p) => !knownBookIds.has(p.data.digitalBookId))
      .map((p) => p.id);
    if (missingBooks.length > 0) {
      throw new HttpsError(
        "invalid-argument",
        `Product(s) reference unknown book(s): ${missingBooks.join(", ")}.`
      );
    }

    // Coupon verification - now possible since Phase 4 moved `coupons`
    // into this project's own database. Resolution goes through the shared
    // pickActiveCoupon (utils/coupons.ts) so all four coupon paths agree:
    // case-insensitive against every coupon (small collection), isActive
    // checked before selection, and EXPIRY honoured - the last of which
    // this path silently skipped until 2026-08-27, so an expired code
    // still discounted a reader Store purchase.
    let coupon: CouponDoc | undefined;
    const trimmedCode = (couponCode ?? "").trim();
    if (trimmedCode) {
      const couponsSnap = await libraryDb.collection(COUPONS).get();
      coupon = pickActiveCoupon(
        couponsSnap.docs.map((d) => d.data()),
        trimmedCode
      ) as CouponDoc | undefined;
      if (!coupon) {
        throw new HttpsError(
          "invalid-argument",
          "Invalid, inactive or expired coupon code."
        );
      }
    }

    // Rebuild the line items server-side - mirrors the reader's
    // buildLineItems exactly.
    const lineItems = products.map(({id, data}) => {
      const price = effectivePrice(data);
      const discount =
        coupon && couponAppliesToProduct(coupon as CouponDoc, id) ?
          round2((price * (coupon.percentOff ?? 0)) / 100) :
          0;
      return {
        id,
        title: data.title ?? id,
        cost: data.cost ?? 0,
        salePrice: data.salePrice,
        imageUrl: data.imageUrl,
        digitalBookId: data.digitalBookId,
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
      const clientSecret = (
        env === "sandbox" ? paypalSandboxSecret : paypalLiveSecret
      ).value();
      const accessToken = await getAccessToken(env, clientSecret);
      const capture = await getOrderCapture(env, accessToken, payPalOrderId);
      assertCaptureMatchesTotal(
        capture,
        total,
        `the computed total ($${total.toFixed(2)})`
      );
    } else if (!isEffectivelyFree(total)) {
      // No PayPal order and the verified pricing isn't free - a forged
      // "free" claim, or a client bug. Either way, no grant.
      throw new HttpsError(
        "failed-precondition",
        `This order totals $${total.toFixed(2)} and requires payment.`
      );
    }

    // Idempotency (sweep 2026-08-17): a client retry with the SAME
    // payPalOrderId must not create a second purchase record + receipt
    // email. receipt == payPalOrderId on a paid order, so a prior success
    // is detectable; return it unchanged. (The grant itself is already
    // idempotent on purchaseId, but the purchase doc + email are not.)
    if (payPalOrderId) {
      const prior = await findPriorPurchaseByReceipt(libraryDb, payPalOrderId);
      if (prior) {
        return {
          granted: true,
          purchaseId: prior.id,
          grantedBookIds: [],
          skippedBookIds: lineItems.map((item) => item.digitalBookId),
          alreadyProcessed: true,
        };
      }
    }

    // Buyer identity fields for the purchase record - same fields the web
    // storefront's checkout collects, best-effort from the patron's own
    // library profile (customer-upsert tolerates their absence).
    const profileSnap = await libraryDb
      .collection(LIBRARY_USERS)
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
    // The receipt IS the coupon code on a coupon-covered order (owner,
    // 2026-09-03; it used to be the literal "COUPON"). The canonical code
    // off the coupon doc, not the casing the patron typed, so it joins
    // exactly against coupons.code.
    const canonicalCode = coupon ? String(coupon.code ?? trimmedCode) : "";
    const receipt = payPalOrderId ?? (coupon ? canonicalCode : "FREE ONLY");
    const purchaseRef = libraryDb.collection(PURCHASES).doc();

    // The purchase record - written BEFORE the direct grant below so the
    // onPurchaseGrantLibraryLicenses trigger (retry: true) is a safety
    // net if this function dies mid-way; both grants key on this doc's id
    // so they converge idempotently.
    await purchaseRef.set({
      source: PURCHASE_SOURCE_READER,
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
      ...(coupon ? {couponCode: canonicalCode} : {}),
      // A Firestore Timestamp, NOT the raw ms number - the admin Purchases
      // list orders by dateProcessed and Firestore sorts mixed types by
      // TYPE (numbers before timestamps), so a number here buries the
      // purchase behind every web-checkout doc, past pagination.
      dateProcessed: Timestamp.fromMillis(now),
      ...(payPalOrderId ? {paypalEnvironment: env} : {}),
    });

    const recipientRef = libraryDb.collection(LIBRARY_USERS).doc(email);
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

    // Pre-prod #1: the purchase receipt email is queued here now (the
    // reader's StoreComponent no longer writes `mail`). Best-effort - the
    // purchase and grant above already succeeded.
    try {
      await queueReaderReceiptEmail(
        libraryDb,
        email,
        profile?.firstName,
        lineItems.map((item) => ({
          title: item.title,
          effectivePrice: item.effectivePrice,
          discount: item.discount,
          finalPrice: item.finalPrice,
        })),
        total,
        receipt
      );
    } catch (mailErr) {
      console.error("Failed to queue reader receipt email", mailErr);
    }

    return {
      granted: true,
      purchaseId: purchaseRef.id,
      grantedBookIds: result.granted,
      skippedBookIds: result.skipped,
    };
  }
);
