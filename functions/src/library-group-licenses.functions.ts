import {onCall, HttpsError} from "firebase-functions/v2/https";
import {PURCHASE_SOURCE_READER} from "./purchase-source";
import {Timestamp, getFirestore} from "firebase-admin/firestore";
import {defineSecret} from "firebase-functions/params";
import {
  getAccessToken,
  getOrderCapture,
  resolvePaypalEnvironment,
} from "./library-paypal";
import {applyLicenseGrant} from "./library-group-license-grant";
import {
  ProductDoc,
  computeGroupLicensePricing,
  effectivePrice,
} from "./library-store-pricing";
import {BulkDiscountTier} from "./common/models/bulk-discount-tier.model";
import {
  chooseLicenseDiscount,
  resolveBulkDiscountPercent,
} from "./common/models/bulk-discount.util";
import {queueInviteDeclineEmail} from "./transactional-emails";
import {applyLicenseRevoke} from "./library-group-license-revoke";
import {selectMembersToCopy} from "./library-group-members-copy";
import {
  AcceptGroupInviteRequest,
  AcceptGroupInviteResult,
  AssignGroupLicenseRequest,
  AssignGroupLicenseResult,
  CopyGroupMembersResult,
  DeclineGroupInviteRequest,
  DeclineGroupInviteResult,
  GetInviteDetailsRequest,
  GetInviteDetailsResult,
  LeaveGroupAndRevokeLicenseRequest,
  LeaveGroupAndRevokeLicenseResult,
  PurchaseGroupLicensesRequest,
  PurchaseGroupLicensesResult,
  RevokeGroupLicenseRequest,
  RevokeGroupLicenseResult,
} from "./common/shared/contract/library-callables.types";

/**
 * Ported from impact-discipleship-library-manager-new's own Impact Group
 * license/invite Cloud Functions (functions/src/index.ts). Reads/writes
 * THIS project's own default database (Phase 3 migration target) via
 * libraryDb below - discussionGroups/groupLicenses/groupInvites/
 * libraryUsers/bulkDiscountTiers were all migrated here. These are called
 * directly by the READER APP's client code (group-license.service.ts/
 * group-invite.service.ts), not by this app's own UI at all. Authorization
 * here is patron-level (requireGroupLeader: the caller's own email must
 * match the group's creatorEmail), not staff-role - distinct from
 * requireAdminRole, which nothing in this file needs.
 *
 * purchaseGroupLicenses records each verified sale in this project's
 * SHARED `purchases` collection (the same table the web storefront and
 * the reader's own store checkout write - the library's old separate
 * purchases table died with the legacy named database). See the inline
 * comment in that function for how its cart item is shaped so the
 * purchases triggers treat it correctly (no personal book grant for the
 * leader, no fulfillment queue entry).
 *
 * `books` is nested (librarySeries/{s}/books/{b}), so getInviteDetails'
 * book lookup goes through a `collectionGroup('books')` scan matched by
 * doc id, same pattern this app's own LibraryBookService.getById() uses.
 */
const libraryDb = getFirestore();

/** The public shape of a `coupons` doc this function needs. Mirrors
 *  library-purchases.functions.ts's own local copy, plus `expiresAt`
 *  (which that one does not read - see the expiry note at the call site). */
interface CouponDoc {
  code?: string;
  isActive?: boolean;
  percentOff?: number | null;
  expiresAt?: unknown;
  tags?: {id: string}[];
}

/**
 * Whether a coupon's expiry has passed. Absent means it never expires,
 * which every coupon written before Campaign Manager v3 was. Accepts the
 * three shapes the field is stored in (Firestore Timestamp, Date, ISO
 * string), same as checkout-support's own isExpired.
 * @param {unknown} expiresAt The stored expiry.
 * @return {boolean} True when it has passed.
 */
function isCouponExpired(expiresAt: unknown): boolean {
  if (expiresAt === null || expiresAt === undefined) {
    return false;
  }
  const value = expiresAt as {toMillis?: () => number};
  const ms =
    typeof value.toMillis === "function" ?
      value.toMillis() :
      new Date(expiresAt as string | number | Date).getTime();
  return Number.isFinite(ms) && ms > 0 && ms < Date.now();
}

/**
 * A coupon with no tags applies to every product; otherwise only to
 * products whose doc id is tagged - mirrors the reader's couponAppliesTo
 * and library-purchases' own copy.
 * @param {CouponDoc} coupon The coupon doc's data.
 * @param {string} productId The product's doc id.
 * @return {boolean} Whether the coupon discounts this product.
 */
function couponAppliesToProduct(
  coupon: CouponDoc,
  productId: string
): boolean {
  return (
    !coupon.tags?.length || coupon.tags.some((tag) => tag.id === productId)
  );
}

const paypalSandboxSecret = defineSecret("PAYPAL_SANDBOX_CLIENT_SECRET");
const paypalLiveSecret = defineSecret("PAYPAL_LIVE_CLIENT_SECRET");

/**
 * Whether a libraryUsers snapshot already holds ANY license for `bookId`.
 * Guards every group-license grant path (purchase self-assign, manual
 * assign, invite acceptance): applyLicenseGrant REPLACES an existing
 * same-book bookLicenses entry, so granting a group license to someone
 * who bought (or was admin-granted) the book would silently downgrade
 * their permanent license to a revocable group one - the leader could
 * then effectively take away a book the member paid for, which is
 * exactly what applyLicenseRevoke's own provenance care exists to
 * prevent. A non-array licensedBookIds (the staff 'all' sentinel) also
 * counts as licensed.
 * @param {FirebaseFirestore.DocumentSnapshot} snap The recipient's
 * libraryUsers doc snapshot.
 * @param {string} bookId The book in question.
 * @return {boolean} Whether they already hold a license for it.
 */
function alreadyLicensedFor(
  snap: FirebaseFirestore.DocumentSnapshot,
  bookId: string
): boolean {
  if (!snap.exists) {
    return false;
  }
  const ids = (snap.data() as {licensedBookIds?: unknown}).licensedBookIds;
  return (
    (ids !== undefined && !Array.isArray(ids)) ||
    (Array.isArray(ids) && ids.includes(bookId))
  );
}

/**
 * Throws unless `email` (the caller's own token email) matches
 * discussionGroups/{groupId}.creatorEmail - the authorization model for
 * every group-license function below. Returns the group's own data so
 * callers don't need a second read.
 * @param {string | undefined} email The caller's own token email.
 * @param {string} groupId The Impact Group's id.
 * @return {Promise<FirebaseFirestore.DocumentData>} The group's data.
 */
async function requireGroupLeader(
  email: string | undefined,
  groupId: string
): Promise<FirebaseFirestore.DocumentData> {
  if (!email) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const groupSnap = await libraryDb
    .collection("discussionGroups")
    .doc(groupId)
    .get();
  const group = groupSnap.data();
  if (!groupSnap.exists || !group) {
    throw new HttpsError("not-found", "Impact Group not found.");
  }
  if (group.creatorEmail !== email.trim().toLowerCase()) {
    throw new HttpsError(
      "permission-denied",
      "Only this Impact Group's leader can do that."
    );
  }
  return group;
}

/**
 * Records a group leader's bulk license purchase (impact-discipleship-
 * library-new's "Buy Licenses" dialog) and creates `quantity` new
 * unassigned `groupLicenses` docs for it. Needs the Admin SDK because
 * `purchases` is create-only from any client, but this write also needs
 * to bundle in the license-pool docs atomically, and only *this* group's
 * leader (not just any signed-in patron) may do it.
 */
export const purchaseGroupLicenses = onCall(
  {secrets: [paypalSandboxSecret, paypalLiveSecret]},
  async (request): Promise<PurchaseGroupLicensesResult> => {
    const email = request.auth?.token.email?.trim().toLowerCase();
    const uid = request.auth?.uid;
    if (!email || !uid) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }

    const {groupId, quantity, payPalOrderId, couponCode} =
      (request.data ?? {}) as Partial<PurchaseGroupLicensesRequest>;
    if (
      !groupId ||
      !quantity ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 1000
    ) {
      throw new HttpsError(
        "invalid-argument",
        "groupId and a whole quantity between 1 and 1000 are required."
      );
    }

    const group = await requireGroupLeader(email, groupId);
    const bookId = group.bookId as string;

    // SERVER-AUTHORITATIVE PRICING. Everything below is recomputed from the
    // product doc + the discount-tier collection; the client's own
    // subtotal/discount/total/percentOff/paypalEnvironment are ignored
    // entirely. (Sweep 3, 2026-08-17: the old code compared the PayPal
    // capture only to the CLIENT-supplied `total`, so paying $0.01 minted up
    // to 1000 licenses. verifyAndGrantReaderStorePurchase already rebuilds
    // from `products`; this now matches.)
    const productsSnap = await libraryDb
      .collection("products")
      .where("digitalBookId", "==", bookId)
      .get();
    // Keep the doc ID, not just the data: a coupon's `tags` reference
    // product doc ids, so tag scoping cannot be evaluated without it.
    const productMatch = productsSnap.docs
      .map((d) => ({id: d.id, data: d.data() as ProductDoc}))
      .find(
        ({data}) => data.isDigitalBook === true && data.isActive !== false
      );
    const product = productMatch?.data;
    if (!product || !productMatch) {
      throw new HttpsError(
        "invalid-argument",
        "No active digital-book product exists for this group's book."
      );
    }
    const unitPrice = effectivePrice(product);

    const tiersSnap = await libraryDb.collection("bulkDiscountTiers").get();
    const tiers = tiersSnap.docs.map((d) => d.data() as BulkDiscountTier);
    // The SHARED tier lookup (submodule, copied in by sync-shared.js) - the
    // reader app prices its own purchase preview with the exact same
    // function, so the quoted and charged amounts can't diverge. `?? 0`
    // guards a malformed tier row whose percentOff isn't set.
    const resolvedPercentOff = resolveBulkDiscountPercent(tiers, quantity) ?? 0;

    // COUPON, also server-side. The client sends a CODE, never a percentage
    // - the same rule as the price - so a leader cannot invent a discount by
    // editing the request. Resolved the way the Store's own
    // verifyAndGrantReaderStorePurchase resolves it: a case-insensitive scan
    // of the small `coupons` collection, since stored codes are not
    // consistently cased.
    //
    // Expiry IS checked here. The Store's equivalent only checks isActive,
    // so an expired code still discounts a purchase there - a real gap, and
    // one worth not reproducing (see coupon.model.ts, which claims expiry
    // "cannot be skipped client-side").
    let couponPercentOff: number | null = null;
    const trimmedCode = (couponCode ?? "").trim();
    if (trimmedCode) {
      const couponsSnap = await libraryDb.collection("coupons").get();
      const coupon = couponsSnap.docs
        .map((d) => d.data() as CouponDoc)
        .find(
          (c) =>
            c.isActive === true &&
            !isCouponExpired(c.expiresAt) &&
            (c.code ?? "").toLowerCase() === trimmedCode.toLowerCase()
        );
      if (!coupon) {
        throw new HttpsError(
          "invalid-argument",
          "Invalid, inactive or expired coupon code."
        );
      }
      // A tagged coupon only covers the products it names. An inapplicable
      // one is IGNORED rather than rejected - matching the Store, where a
      // coupon simply discounts nothing it does not cover - and stays null
      // so chooseLicenseDiscount does not report that bulk "beat" a coupon
      // that was never in the running. The dialog tells the leader at
      // apply-time that the code does not cover this book.
      if (couponAppliesToProduct(coupon, productMatch.id)) {
        couponPercentOff =
          typeof coupon.percentOff === "number" ? coupon.percentOff : 0;
      }
    }

    // Bulk and coupon are EXCLUSIVE, better-of-the-two, tie to bulk - the
    // shared helper the dialog previews with, so quoted and charged agree.
    const discountChoice = chooseLicenseDiscount(
      resolvedPercentOff,
      couponPercentOff
    );

    const {discount, total, unitDiscountPrice} = computeGroupLicensePricing(
      unitPrice,
      quantity,
      discountChoice.percentOff
    );

    if (!payPalOrderId && total > 0) {
      throw new HttpsError(
        "invalid-argument",
        "payPalOrderId is required for a non-zero total."
      );
    }

    let verifiedCaptureId: string | undefined;
    if (payPalOrderId) {
      const env = resolvePaypalEnvironment();
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
      // Verify against the SERVER-computed total, cent-level tolerance for
      // rounding only.
      if (
        capture.currencyCode !== "USD" ||
        Math.abs(capture.amount - total) > 0.01
      ) {
        throw new HttpsError(
          "failed-precondition",
          `PayPal payment (${capture.currencyCode} ${capture.amount}) ` +
            `does not match the price for ${quantity} license` +
            `${quantity === 1 ? "" : "s"} ($${total.toFixed(2)}).`
        );
      }
      verifiedCaptureId = capture.captureId;

      // Idempotency (sweep 2026-08-17): a client retry with the SAME
      // payPalOrderId must not mint a second batch of licenses. The
      // purchase doc stamps receipt == payPalOrderId, so a prior success
      // is detectable - return its existing purchase + licenses instead of
      // creating duplicates. (PayPal itself only captures an order once,
      // but the license/purchase writes happen after that and can be
      // replayed by a retried callable.)
      const prior = await libraryDb.collection("purchases")
        .where("receipt", "==", payPalOrderId).limit(1).get();
      if (!prior.empty) {
        const priorId = prior.docs[0].id;
        const priorLicenses = await libraryDb.collection("groupLicenses")
          .where("purchaseId", "==", priorId).get();
        return {
          purchaseId: priorId,
          licenseIds: priorLicenses.docs.map((d) => d.id),
        };
      }
    }

    const now = Date.now();
    const purchaseRef = libraryDb.collection("purchases").doc();
    const licenseRefs = Array.from({length: quantity}, () =>
      libraryDb.collection("groupLicenses").doc()
    );
    // Group-license sales land in the shared `purchases` table like every
    // other sale (2026-08-17 direction), so they show in admin's
    // Purchases screen and the leader becomes a customer/Mailchimp
    // contact via onPurchaseCustomerUpsert like any other buyer. The
    // cart item is deliberately shaped `isDigitalBook: true` with NO
    // `digitalBookId`: that combination is invisible to BOTH
    // onPurchaseGrantLibraryLicenses (which requires digitalBookId - the
    // licenses are for assignment to members, the leader must not be
    // personally granted the book) and hasPhysicalItem (so fulfillment
    // auto-closes it instead of queueing a shippable order).
    const leaderProfileSnap = await libraryDb
      .collection("libraryUsers")
      .doc(email)
      .get();
    const leaderProfile = leaderProfileSnap.exists ?
      (leaderProfileSnap.data() as {
          firstName?: string;
          lastName?: string;
          phone?: string;
        }) :
      undefined;
    await purchaseRef.set({
      source: PURCHASE_SOURCE_READER,
      email,
      userId: uid,
      ...(leaderProfile?.firstName ?
        {firstName: leaderProfile.firstName} :
        {}),
      ...(leaderProfile?.lastName ? {lastName: leaderProfile.lastName} : {}),
      ...(leaderProfile?.phone ? {phone: leaderProfile.phone} : {}),
      cartItems: [
        {
          id: bookId,
          itemName:
            `${group.title} - ${quantity} group license` +
            `${quantity === 1 ? "" : "s"}`,
          price: unitPrice,
          orderQuantity: quantity,
          discount: discount,
          discountPrice: unitDiscountPrice,
          isDigitalBook: true,
        },
      ],
      discount: discount,
      total: total,
      // What the discount actually WAS, so a purchase can be explained later
      // without re-deriving it from tiers that may since have changed.
      discountSource: discountChoice.source,
      bulkPercentOff: discountChoice.bulkPercentOff,
      ...(trimmedCode ?
        {
          couponCode: trimmedCode,
          couponPercentOff: discountChoice.couponPercentOff,
          couponApplied: discountChoice.source === "coupon",
        } :
        {}),
      receipt: payPalOrderId ?? "FREE ONLY",
      // A Firestore Timestamp, NOT the raw ms number - the admin Purchases
      // list orders by dateProcessed and Firestore sorts mixed types by
      // TYPE (numbers before timestamps), so a number here buries the
      // purchase behind every web-checkout doc, past pagination.
      dateProcessed: Timestamp.fromMillis(now),
      ...(verifiedCaptureId ? {paypalCaptureId: verifiedCaptureId} : {}),
      ...(payPalOrderId ?
        {paypalEnvironment: resolvePaypalEnvironment()} :
        {}),
    });

    // Chunked rather than one batch() - Firestore caps a WriteBatch at
    // 500 operations and `quantity` alone can reach 1000. purchaseId is
    // the purchase doc's own id again - the reader's My License Purchases
    // screen groups a bulk buy's licenses by this field.
    const CHUNK_SIZE = 400;
    for (let i = 0; i < licenseRefs.length; i += CHUNK_SIZE) {
      const batch = libraryDb.batch();
      for (const ref of licenseRefs.slice(i, i + CHUNK_SIZE)) {
        batch.set(ref, {
          leaderEmail: email,
          bookId,
          purchaseId: purchaseRef.id,
          status: "unassigned",
          createdAt: now,
          ...(verifiedCaptureId ? {paypalCaptureId: verifiedCaptureId} : {}),
        });
      }
      await batch.commit();
    }

    // Auto-assign ONE of the just-purchased licenses to the leader
    // themselves (2026-08-17 request: buy 5 -> 1 self-assigned, 4 left to
    // hand out), UNLESS they already hold a license for this book - see
    // alreadyLicensedFor for why granting anyway would be worse than
    // wasteful.
    let selfAssignedLicenseId: string | undefined;
    const leaderRef = libraryDb.collection("libraryUsers").doc(email);
    await libraryDb.runTransaction(async (transaction) => {
      const leaderSnap = await transaction.get(leaderRef);
      if (alreadyLicensedFor(leaderSnap, bookId)) {
        return;
      }
      applyLicenseGrant({
        transaction,
        licenseRef: licenseRefs[0],
        recipientRef: leaderRef,
        recipientSnap: leaderSnap,
        bookId,
        licenseId: licenseRefs[0].id,
        groupId,
        recipientEmail: email,
        now,
      });
      selfAssignedLicenseId = licenseRefs[0].id;
    });

    return {
      purchaseId: purchaseRef.id,
      licenseIds: licenseRefs.map((r) => r.id),
      ...(selfAssignedLicenseId ? {selfAssignedLicenseId} : {}),
      // The SERVER's verdict, so the dialog confirms what was charged
      // rather than trusting the preview it computed itself.
      discountSource: discountChoice.source,
      bulkBeatsCoupon: discountChoice.bulkBeatsCoupon,
    };
  }
);

/**
 * Hands one of a leader's unassigned GroupLicense units to an approved
 * member of one of their groups - the write into that member's OWN
 * `libraryUsers/{email}` doc is exactly what firestore.rules blocks from
 * any client (including the leader's), so this has to happen here.
 */
export const assignGroupLicense = onCall(async (request):
  Promise<AssignGroupLicenseResult> => {
  const email = request.auth?.token.email?.trim().toLowerCase();
  if (!email) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const {licenseId, groupId, recipientEmail} =
    (request.data ?? {}) as Partial<AssignGroupLicenseRequest>;
  if (!licenseId || !groupId || !recipientEmail) {
    throw new HttpsError(
      "invalid-argument",
      "licenseId, groupId, and recipientEmail are required."
    );
  }

  const group = await requireGroupLeader(email, groupId);
  const recipient = recipientEmail.trim().toLowerCase();

  const licenseRef = libraryDb.collection("groupLicenses").doc(licenseId);
  const memberRef = libraryDb
    .collection("discussionGroups")
    .doc(groupId)
    .collection("members")
    .doc(recipient);
  const recipientRef = libraryDb.collection("libraryUsers").doc(recipient);

  await libraryDb.runTransaction(async (transaction) => {
    const [licenseSnap, memberSnap, recipientSnap] = await Promise.all([
      transaction.get(licenseRef),
      transaction.get(memberRef),
      transaction.get(recipientRef),
    ]);
    const license = licenseSnap.data();
    if (!licenseSnap.exists || !license) {
      throw new HttpsError("not-found", "License not found.");
    }
    if (license.leaderEmail !== email) {
      throw new HttpsError(
        "permission-denied",
        "This license does not belong to you."
      );
    }
    if (license.status !== "unassigned") {
      throw new HttpsError(
        "failed-precondition",
        "This license has already been assigned."
      );
    }
    if (license.bookId !== group.bookId) {
      throw new HttpsError(
        "failed-precondition",
        "This license is for a different book than this group's current book."
      );
    }
    if (!memberSnap.exists || memberSnap.data()?.status !== "approved") {
      throw new HttpsError(
        "failed-precondition",
        "The recipient must be an approved member of this Impact Group."
      );
    }
    // A clear error rather than a silent skip: the leader clicked Assign
    // and should learn why nothing was consumed. See alreadyLicensedFor.
    if (alreadyLicensedFor(recipientSnap, license.bookId as string)) {
      throw new HttpsError(
        "failed-precondition",
        "This member already has this book (purchased or granted " +
          "separately) - the license was not assigned and remains " +
          "available."
      );
    }

    applyLicenseGrant({
      transaction,
      licenseRef,
      recipientRef,
      recipientSnap,
      bookId: license.bookId,
      licenseId,
      groupId,
      recipientEmail: recipient,
      now: Date.now(),
    });
  });

  return {success: true};
});

/**
 * Takes back a previously-assigned GroupLicense, freeing it into the
 * leader's reserve for that book. Rejects once the license's own group
 * has closed or moved to a different book - that single check is what
 * makes an assignment permanent at that point.
 */
export const revokeGroupLicense = onCall(async (request):
  Promise<RevokeGroupLicenseResult> => {
  const email = request.auth?.token.email?.trim().toLowerCase();
  if (!email) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const {licenseId} =
    (request.data ?? {}) as Partial<RevokeGroupLicenseRequest>;
  if (!licenseId) {
    throw new HttpsError("invalid-argument", "licenseId is required.");
  }

  const licenseRef = libraryDb.collection("groupLicenses").doc(licenseId);

  await libraryDb.runTransaction(async (transaction) => {
    const licenseSnap = await transaction.get(licenseRef);
    const license = licenseSnap.data();
    if (!licenseSnap.exists || !license) {
      throw new HttpsError("not-found", "License not found.");
    }
    if (license.leaderEmail !== email) {
      throw new HttpsError(
        "permission-denied",
        "This license does not belong to you."
      );
    }
    if (
      license.status !== "assigned" ||
      !license.assignedGroupId ||
      !license.assignedToEmail
    ) {
      throw new HttpsError(
        "failed-precondition",
        "This license is not currently assigned."
      );
    }

    const groupSnap = await transaction.get(
      libraryDb.collection("discussionGroups").doc(license.assignedGroupId)
    );
    const group = groupSnap.exists ? groupSnap.data() : undefined;
    // A DELETED group is deliberately not the same case as a closed one.
    // Closing is the leader's own act, and locking the assignment is what
    // makes it permanent - that is the rule. Deletion is staff moderation
    // the leader had no say in, and treating it as "closed" silently burned
    // a purchased unit forever: the leader could never reclaim it, while
    // the recipient kept the book (their grant lives on libraryUsers, which
    // the group cascade never touched). So a missing group lets the revoke
    // proceed - see onGroupDeletedCleanup, which flags these rather than
    // revoking automatically, leaving it the leader's deliberate choice.
    if (!group) {
      const recipientRef = libraryDb
        .collection("libraryUsers")
        .doc(license.assignedToEmail);
      const recipientSnap = await transaction.get(recipientRef);
      applyLicenseRevoke({
        transaction,
        licenseRef,
        recipientRef,
        recipientSnap,
        licenseId,
        bookId: license.bookId as string,
      });
      return;
    }
    if (
      group["status"] !== "open" ||
      group["bookId"] !== license.bookId
    ) {
      throw new HttpsError(
        "failed-precondition",
        "This Impact Group has closed or changed books, so this " +
          "license can no longer be revoked."
      );
    }

    const recipientRef = libraryDb
      .collection("libraryUsers")
      .doc(license.assignedToEmail);
    const recipientSnap = await transaction.get(recipientRef);
    applyLicenseRevoke({
      transaction,
      licenseRef,
      recipientRef,
      recipientSnap,
      licenseId,
      bookId: license.bookId as string,
    });
  });

  return {success: true};
});

/**
 * Leaves a group and, if the caller currently holds an assigned group
 * license for it, revokes that license in the same transaction - so "a
 * license follows you only while you're in the group" actually holds.
 */
export const leaveGroupAndRevokeLicense = onCall(async (request):
  Promise<LeaveGroupAndRevokeLicenseResult> => {
  const email = request.auth?.token.email?.trim().toLowerCase();
  if (!email) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const {groupId} =
    (request.data ?? {}) as Partial<LeaveGroupAndRevokeLicenseRequest>;
  if (!groupId) {
    throw new HttpsError("invalid-argument", "groupId is required.");
  }

  const groupRef = libraryDb.collection("discussionGroups").doc(groupId);
  const memberRef = groupRef.collection("members").doc(email);

  await libraryDb.runTransaction(async (transaction) => {
    const groupSnap = await transaction.get(groupRef);
    const group = groupSnap.exists ? groupSnap.data() : undefined;

    if (group && group["status"] === "open") {
      const licenseQuerySnap = await transaction.get(
        libraryDb
          .collection("groupLicenses")
          .where("assignedGroupId", "==", groupId)
          .where("assignedToEmail", "==", email)
          .where("status", "==", "assigned")
          .limit(1)
      );
      if (!licenseQuerySnap.empty) {
        const licenseDoc = licenseQuerySnap.docs[0];
        const license = licenseDoc.data();
        const recipientRef = libraryDb.collection("libraryUsers").doc(email);
        const recipientSnap = await transaction.get(recipientRef);
        applyLicenseRevoke({
          transaction,
          licenseRef: licenseDoc.ref,
          recipientRef,
          recipientSnap,
          licenseId: licenseDoc.id,
          bookId: license["bookId"] as string,
        });
      }
    }

    transaction.delete(memberRef);
  });

  return {success: true};
});

/**
 * Copies every currently-approved member of `sourceGroupId` (except the
 * caller) into `targetGroupId` as pre-approved members - the reader app's
 * "Start Group for Next Book"/"Promote to Next Book" clone action.
 */
export const copyGroupMembers = onCall(async (request):
  Promise<CopyGroupMembersResult> => {
  const email = request.auth?.token.email?.trim().toLowerCase();
  if (!email) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const {sourceGroupId, targetGroupId, memberEmails} = (request.data ??
    {}) as {
    sourceGroupId?: string;
    targetGroupId?: string;
    memberEmails?: string[];
  };
  if (!sourceGroupId || !targetGroupId) {
    throw new HttpsError(
      "invalid-argument",
      "sourceGroupId and targetGroupId are required."
    );
  }
  if (sourceGroupId === targetGroupId) {
    throw new HttpsError(
      "invalid-argument",
      "sourceGroupId and targetGroupId must be different groups."
    );
  }

  // Checking only sourceGroupId would let any leader dump their own
  // group's roster into an ARBITRARY other group they don't own -
  // requiring leadership of the target too closes that gap and
  // guarantees both groups share one creator.
  await requireGroupLeader(email, sourceGroupId);
  const targetGroup = await requireGroupLeader(email, targetGroupId);

  const [sourceMembersSnap, targetMembersSnap] = await Promise.all([
    libraryDb
      .collection("discussionGroups")
      .doc(sourceGroupId)
      .collection("members")
      .get(),
    libraryDb
      .collection("discussionGroups")
      .doc(targetGroupId)
      .collection("members")
      .get(),
  ]);
  const sourceMembers = sourceMembersSnap.docs.map(
    (d) => d.data() as { email: string; displayName: string; status: string }
  );
  const existingTargetEmails = new Set(targetMembersSnap.docs.map((d) => d.id));
  const allowedEmails = memberEmails ?
    new Set(memberEmails.map((e) => e.trim().toLowerCase())) :
    undefined;
  const toCopy = selectMembersToCopy(
    sourceMembers,
    existingTargetEmails,
    email,
    allowedEmails
  );

  const now = Date.now();
  const targetMembersRef = libraryDb
    .collection("discussionGroups")
    .doc(targetGroupId)
    .collection("members");
  const batch = libraryDb.batch();
  for (const member of toCopy) {
    batch.set(targetMembersRef.doc(member.email), {
      groupId: targetGroupId,
      email: member.email,
      displayName: member.displayName,
      status: "approved",
      requestedAt: now,
      respondedAt: now,
    });
  }
  await batch.commit();

  // Mirrors the reader app's own auto-close-at-capacity behavior, so a
  // clone can't silently exceed its own size limit.
  const maxMembers = targetGroup.maxMembers as number | undefined;
  const existingApprovedExcludingCaller = targetMembersSnap.docs.filter(
    (d) => d.id !== email && d.data().status === "approved"
  ).length;
  const newApprovedCount = existingApprovedExcludingCaller + toCopy.length;
  if (maxMembers && newApprovedCount >= maxMembers) {
    await libraryDb
      .collection("discussionGroups")
      .doc(targetGroupId)
      .update({status: "closed", closedAt: now, updatedAt: now});
  }

  return {copiedCount: toCopy.length};
});

/**
 * Public preview for a not-yet-signed-in invitee landing on an invite
 * link - no auth required. Live-reads the group/book so an edited meeting
 * time/location is always reflected, even for already-sent invites.
 */
export const getInviteDetails = onCall(async (request):
  Promise<GetInviteDetailsResult> => {
  const {inviteId} = (request.data ?? {}) as Partial<GetInviteDetailsRequest>;
  if (!inviteId) {
    throw new HttpsError("invalid-argument", "inviteId is required.");
  }
  const inviteSnap = await libraryDb
    .collection("groupInvites")
    .doc(inviteId)
    .get();
  const invite = inviteSnap.data();
  if (!inviteSnap.exists || !invite) {
    throw new HttpsError("not-found", "This invite could not be found.");
  }

  // A bare book id doesn't say which series/book it's nested under - scans
  // every series' `books` subcollection once via a collectionGroup query
  // rather than a direct doc() lookup. Fine at this library's real scale
  // (a handful of books total).
  const [groupSnap, booksSnap] = await Promise.all([
    libraryDb.collection("discussionGroups").doc(invite.groupId).get(),
    libraryDb.collectionGroup("books").get(),
  ]);
  // .data() already returns undefined for a non-existent doc, so this is
  // equivalent to the previous `groupSnap.exists ? groupSnap.data()! :
  // undefined` without needing the assertion.
  const group = groupSnap.data();
  const book = booksSnap.docs.find((d) => d.id === invite.bookId)?.data();

  // Deliberately NOT reporting whether `inviteeEmail` already has an
  // account here - would turn this into a free account-enumeration
  // oracle for arbitrary emails (any signed-in patron can create their
  // own invite-only group and generate an invite naming any email, then
  // call this no-auth function on their own just-created invite).
  return {
    status: invite.status as GetInviteDetailsResult["status"],
    inviteeEmail: invite.inviteeEmail as string,
    leaderDisplayName: invite.leaderDisplayName as string,
    groupTitle:
      (group?.title as string | undefined) ?? (invite.groupTitle as string),
    bookTitle: (book?.title as string | undefined) ?? "this book",
    startDate: group?.startDate as number | undefined,
    startTimeZone: group?.startTimeZone as string | undefined,
    onlineInfo: group?.onlineInfo as string | undefined,
    locationSummary: group?.location ?
      [group.location.city, group.location.state].filter(Boolean).join(", ") :
      (group?.inPersonLocation as string | undefined),
    licenseIntent: invite.licenseIntent as boolean,
  };
});

/**
 * Declines an invite - no auth required, same reasoning as
 * getInviteDetails. Idempotent: a reload or double-click after already
 * declining/accepting must never error, it just no-ops.
 */
export const declineGroupInvite = onCall(async (request):
  Promise<DeclineGroupInviteResult> => {
  const {inviteId, reason} =
    (request.data ?? {}) as Partial<DeclineGroupInviteRequest>;
  if (!inviteId) {
    throw new HttpsError("invalid-argument", "inviteId is required.");
  }
  // Optional and capped - free text from an unauthenticated visitor, same
  // 4000-char ceiling firestore.rules already applies to every other
  // patron-authored text field in this feature (chat/prayer).
  const trimmedReason =
    typeof reason === "string" ? reason.trim().slice(0, 4000) : undefined;
  const inviteRef = libraryDb.collection("groupInvites").doc(inviteId);
  const inviteSnap = await inviteRef.get();
  const invite = inviteSnap.data();
  if (!inviteSnap.exists || !invite) {
    throw new HttpsError("not-found", "This invite could not be found.");
  }
  const justDeclined = invite.status === "pending";
  if (justDeclined) {
    await inviteRef.update({
      status: "declined",
      respondedAt: Date.now(),
      ...(trimmedReason ? {declineReason: trimmedReason} : {}),
    });

    // Pre-prod #1: the leader's decline notification is queued here now
    // (the reader's InviteLandingComponent no longer writes `mail`).
    // Best-effort, matching the client's old behavior - a failed
    // notification never blocks the invitee's own decline.
    try {
      await queueInviteDeclineEmail(
        libraryDb,
        invite.leaderEmail as string,
        (invite.leaderDisplayName as string | undefined) ??
          (invite.leaderEmail as string),
        (invite.groupTitle as string | undefined) ?? "your Impact Group",
        invite.inviteeEmail as string,
        trimmedReason
      );
    } catch (mailErr) {
      console.error("Failed to queue invite-decline email", mailErr);
    }
  }
  return {
    justDeclined,
    leaderEmail: invite.leaderEmail as string,
    leaderDisplayName: invite.leaderDisplayName as string,
    groupTitle: invite.groupTitle as string,
    inviteeEmail: invite.inviteeEmail as string,
    declineReason: justDeclined ?
      trimmedReason :
      (invite.declineReason as string | undefined),
  };
});

/**
 * Accepts an invite - requires the caller's own signed-in email to match
 * the invite's inviteeEmail. Writes the caller's own 'approved' membership
 * doc and, if the invite carries a license intent, attempts to grant one
 * of the leader's still-unassigned units for the group's book. Idempotent
 * against a double-submitted accept.
 */
export const acceptGroupInvite = onCall(async (request):
  Promise<AcceptGroupInviteResult> => {
  const email = request.auth?.token.email?.trim().toLowerCase();
  if (!email) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const {inviteId} = (request.data ?? {}) as Partial<AcceptGroupInviteRequest>;
  if (!inviteId) {
    throw new HttpsError("invalid-argument", "inviteId is required.");
  }

  const inviteRef = libraryDb.collection("groupInvites").doc(inviteId);
  const inviteSnap = await inviteRef.get();
  const invite = inviteSnap.data();
  if (!inviteSnap.exists || !invite) {
    throw new HttpsError("not-found", "This invite could not be found.");
  }
  if (invite.inviteeEmail !== email) {
    throw new HttpsError(
      "permission-denied",
      "This invite was sent to a different email address."
    );
  }
  if (invite.status === "declined") {
    throw new HttpsError(
      "failed-precondition",
      "This invite has already been declined."
    );
  }

  const groupId = invite.groupId as string;
  const bookId = invite.bookId as string;

  // An invite is SINGLE-USE. Only a still-pending invite joins the group and
  // pulls a license; an already-accepted one is a no-op that returns success
  // (idempotent for a double-click/retry). Without this, a member could
  // leaveGroupAndRevokeLicense - which deletes the member doc and returns the
  // license to the pool - then re-POST the same inviteId to re-join and pull
  // a FRESH license, making revokeGroupLicense unenforceable (Sweep 3,
  // 2026-08-17). The membership-set + grant are gated on isPending below.
  const isPending = invite.status === "pending";

  // The invite freezes bookId at send time; if the group's book was changed
  // afterward, honoring the frozen book would grant a license for a book the
  // group no longer studies. assignGroupLicense already guards this.
  if (isPending) {
    const groupBookSnap = await libraryDb
      .collection("discussionGroups")
      .doc(groupId)
      .get();
    // The group must still EXIST. Without this the accept ran on regardless
    // and wrote members/{email} under a group document that is gone -
    // Firestore happily creates a subcollection beneath a missing parent, so
    // the invitee ended up an approved member of a ghost group, visible in
    // getMyMemberships (a collectionGroup query) and openable to nothing.
    // The book-change guard below could not catch it either: a deleted group
    // yields an undefined bookId, so its `groupBookId &&` test was skipped.
    if (!groupBookSnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "This Impact Group is no longer available."
      );
    }
    const groupBookId = groupBookSnap.data()?.bookId as string | undefined;
    if (groupBookId && groupBookId !== bookId) {
      throw new HttpsError(
        "failed-precondition",
        "This group's book has changed since the invite was sent - " +
          "please ask the leader for a new invite."
      );
    }
  }
  const memberRef = libraryDb
    .collection("discussionGroups")
    .doc(groupId)
    .collection("members")
    .doc(email);

  // Firestore transactions can't run arbitrary queries, so a candidate
  // unassigned license is picked outside the transaction, then
  // re-verified inside it - if a race already took it, this simply skips
  // the grant rather than retrying.
  let candidateLicenseId: string | undefined;
  if (invite.licenseIntent) {
    const candidateSnap = await libraryDb
      .collection("groupLicenses")
      .where("leaderEmail", "==", invite.leaderEmail)
      .where("bookId", "==", bookId)
      .where("status", "==", "unassigned")
      .limit(1)
      .get();
    candidateLicenseId = candidateSnap.docs[0]?.id;
  }

  const result = await libraryDb.runTransaction(async (transaction) => {
    const licenseRef = candidateLicenseId ?
      libraryDb.collection("groupLicenses").doc(candidateLicenseId) :
      undefined;
    const recipientRef = libraryDb.collection("libraryUsers").doc(email);

    const [memberSnap, licenseSnap, recipientSnap] = await Promise.all([
      transaction.get(memberRef),
      licenseRef ? transaction.get(licenseRef) : Promise.resolve(undefined),
      transaction.get(recipientRef),
    ]);

    const alreadyApproved =
      memberSnap.exists && memberSnap.data()?.status === "approved";
    // Only a still-pending invite joins/grants; a re-accept after leaving
    // (invite already 'accepted') falls through to a no-op success.
    if (isPending && !alreadyApproved) {
      transaction.set(memberRef, {
        groupId,
        email,
        displayName: (request.auth?.token.name as string | undefined) ?? email,
        status: "approved",
        requestedAt: Date.now(),
        respondedAt: Date.now(),
      });
    }

    // Skip (never fail) the grant when the invitee already holds a
    // license for this book - membership is still approved, the invite
    // still completes, and the license stays UNASSIGNED in the leader's
    // pool for someone who actually needs it. See alreadyLicensedFor for
    // why granting anyway would be worse than wasteful.
    let licenseGranted = false;
    let grantedLicenseId: string | undefined;
    if (
      isPending &&
      !alreadyApproved &&
      licenseRef &&
      candidateLicenseId &&
      licenseSnap?.exists &&
      licenseSnap.data()?.status === "unassigned" &&
      !alreadyLicensedFor(recipientSnap, bookId)
    ) {
      applyLicenseGrant({
        transaction,
        licenseRef,
        recipientRef,
        recipientSnap,
        bookId,
        licenseId: candidateLicenseId,
        groupId,
        recipientEmail: email,
        now: Date.now(),
      });
      licenseGranted = true;
      grantedLicenseId = candidateLicenseId;
    }

    if (isPending) {
      transaction.update(inviteRef, {
        status: "accepted",
        respondedAt: Date.now(),
        ...(grantedLicenseId ? {grantedLicenseId} : {}),
      });
    }

    return {licenseGranted};
  });

  const groupSnap = await libraryDb
    .collection("discussionGroups")
    .doc(groupId)
    .get();
  return {
    groupId,
    groupTitle:
      (groupSnap.data()?.title as string | undefined) ??
      (invite.groupTitle as string),
    licenseGranted: result.licenseGranted,
  };
});
