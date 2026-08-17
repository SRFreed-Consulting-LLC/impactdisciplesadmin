import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {defineSecret} from "firebase-functions/params";
import {
  PaypalEnvironment,
  getAccessToken,
  getOrderCapture,
} from "./library-paypal";
import {applyLicenseGrant} from "./library-group-license-grant";
import {applyLicenseRevoke} from "./library-group-license-revoke";
import {selectMembersToCopy} from "./library-group-members-copy";

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
const libraryDb = admin.firestore();

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
  if (!groupSnap.exists) {
    throw new HttpsError("not-found", "Impact Group not found.");
  }
  const group = groupSnap.data()!;
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
  async (request) => {
    const email = request.auth?.token.email?.trim().toLowerCase();
    const uid = request.auth?.uid;
    if (!email || !uid) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }

    const {
      groupId,
      quantity,
      subtotal,
      discount,
      total,
      percentOff,
      payPalOrderId,
      paypalEnvironment,
    } = (request.data ?? {}) as {
      groupId?: string;
      quantity?: number;
      subtotal?: number;
      discount?: number;
      total?: number;
      percentOff?: number;
      payPalOrderId?: string;
      paypalEnvironment?: PaypalEnvironment;
    };
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
    if (!payPalOrderId && (total ?? 0) > 0) {
      throw new HttpsError(
        "invalid-argument",
        "payPalOrderId is required for a non-zero total."
      );
    }

    const group = await requireGroupLeader(email, groupId);
    const bookId = group.bookId as string;

    const tiersSnap = await libraryDb.collection("bulkDiscountTiers").get();
    const tiers = tiersSnap.docs.map(
      (d) => d.data() as { numberOfBooks: number; percentOff: number }
    );
    const resolvedPercentOff =
      tiers
        .filter((t) => t.numberOfBooks <= quantity)
        .reduce<{ numberOfBooks: number; percentOff: number } | undefined>(
          (best, t) =>
            t.numberOfBooks > (best?.numberOfBooks ?? -1) ? t : best,
          undefined
        )?.percentOff ?? 0;
    if (percentOff !== undefined && percentOff !== resolvedPercentOff) {
      throw new HttpsError(
        "failed-precondition",
        "Discount pricing has changed - please refresh and try again."
      );
    }
    // A free (<=0) total is only legitimate at a full 100% discount, the
    // one thing provable from data this project actually has - a claimed
    // free grant with a lesser (or zero) resolved discount can only mean
    // the true, unverifiable price was dropped, not honestly zero.
    if ((total ?? 0) <= 0 && resolvedPercentOff < 100) {
      throw new HttpsError(
        "invalid-argument",
        "A zero-cost purchase requires a 100% discount and a matching " +
          "PayPal-free confirmation."
      );
    }

    let verifiedCaptureId: string | undefined;
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
      // Cent-level tolerance for floating point/rounding, never treated
      // as equality.
      const claimedTotal = total ?? 0;
      if (
        capture.currencyCode !== "USD" ||
        Math.abs(capture.amount - claimedTotal) > 0.01
      ) {
        throw new HttpsError(
          "failed-precondition",
          `PayPal payment (${capture.currencyCode} ${capture.amount}) ` +
            `does not match the claimed total ($${claimedTotal.toFixed(2)}).`
        );
      }
      verifiedCaptureId = capture.captureId;
    }

    const now = Date.now();
    const purchaseRef = libraryDb.collection("purchases").doc();
    const licenseRefs = Array.from({length: quantity}, () =>
      libraryDb.collection("groupLicenses").doc()
    );
    const unitPrice = subtotal ? subtotal / quantity : 0;
    const unitDiscountPrice = total ? total / quantity : 0;

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
          discount: discount ?? 0,
          discountPrice: unitDiscountPrice,
          isDigitalBook: true,
        },
      ],
      discount: discount ?? 0,
      total: total ?? 0,
      receipt: payPalOrderId ?? "FREE ONLY",
      dateProcessed: now,
      ...(verifiedCaptureId ? {paypalCaptureId: verifiedCaptureId} : {}),
      ...(payPalOrderId ?
        {paypalEnvironment: paypalEnvironment ?? "live"} :
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
    };
  }
);

/**
 * Hands one of a leader's unassigned GroupLicense units to an approved
 * member of one of their groups - the write into that member's OWN
 * `libraryUsers/{email}` doc is exactly what firestore.rules blocks from
 * any client (including the leader's), so this has to happen here.
 */
export const assignGroupLicense = onCall(async (request) => {
  const email = request.auth?.token.email?.trim().toLowerCase();
  if (!email) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const {licenseId, groupId, recipientEmail} = (request.data ?? {}) as {
    licenseId?: string;
    groupId?: string;
    recipientEmail?: string;
  };
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
    if (!licenseSnap.exists) {
      throw new HttpsError("not-found", "License not found.");
    }
    const license = licenseSnap.data()!;
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
export const revokeGroupLicense = onCall(async (request) => {
  const email = request.auth?.token.email?.trim().toLowerCase();
  if (!email) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const {licenseId} = (request.data ?? {}) as { licenseId?: string };
  if (!licenseId) {
    throw new HttpsError("invalid-argument", "licenseId is required.");
  }

  const licenseRef = libraryDb.collection("groupLicenses").doc(licenseId);

  await libraryDb.runTransaction(async (transaction) => {
    const licenseSnap = await transaction.get(licenseRef);
    if (!licenseSnap.exists) {
      throw new HttpsError("not-found", "License not found.");
    }
    const license = licenseSnap.data()!;
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
    if (
      !group ||
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
export const leaveGroupAndRevokeLicense = onCall(async (request) => {
  const email = request.auth?.token.email?.trim().toLowerCase();
  if (!email) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const {groupId} = (request.data ?? {}) as { groupId?: string };
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
export const copyGroupMembers = onCall(async (request) => {
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
export const getInviteDetails = onCall(async (request) => {
  const {inviteId} = (request.data ?? {}) as { inviteId?: string };
  if (!inviteId) {
    throw new HttpsError("invalid-argument", "inviteId is required.");
  }
  const inviteSnap = await libraryDb
    .collection("groupInvites")
    .doc(inviteId)
    .get();
  if (!inviteSnap.exists) {
    throw new HttpsError("not-found", "This invite could not be found.");
  }
  const invite = inviteSnap.data()!;

  // A bare book id doesn't say which series/book it's nested under - scans
  // every series' `books` subcollection once via a collectionGroup query
  // rather than a direct doc() lookup. Fine at this library's real scale
  // (a handful of books total).
  const [groupSnap, booksSnap] = await Promise.all([
    libraryDb.collection("discussionGroups").doc(invite.groupId).get(),
    libraryDb.collectionGroup("books").get(),
  ]);
  const group = groupSnap.exists ? groupSnap.data()! : undefined;
  const book = booksSnap.docs.find((d) => d.id === invite.bookId)?.data();

  // Deliberately NOT reporting whether `inviteeEmail` already has an
  // account here - would turn this into a free account-enumeration
  // oracle for arbitrary emails (any signed-in patron can create their
  // own invite-only group and generate an invite naming any email, then
  // call this no-auth function on their own just-created invite).
  return {
    status: invite.status as string,
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
export const declineGroupInvite = onCall(async (request) => {
  const {inviteId, reason} = (request.data ?? {}) as {
    inviteId?: string;
    reason?: string;
  };
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
  if (!inviteSnap.exists) {
    throw new HttpsError("not-found", "This invite could not be found.");
  }
  const invite = inviteSnap.data()!;
  const justDeclined = invite.status === "pending";
  if (justDeclined) {
    await inviteRef.update({
      status: "declined",
      respondedAt: Date.now(),
      ...(trimmedReason ? {declineReason: trimmedReason} : {}),
    });
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
export const acceptGroupInvite = onCall(async (request) => {
  const email = request.auth?.token.email?.trim().toLowerCase();
  if (!email) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const {inviteId} = (request.data ?? {}) as { inviteId?: string };
  if (!inviteId) {
    throw new HttpsError("invalid-argument", "inviteId is required.");
  }

  const inviteRef = libraryDb.collection("groupInvites").doc(inviteId);
  const inviteSnap = await inviteRef.get();
  if (!inviteSnap.exists) {
    throw new HttpsError("not-found", "This invite could not be found.");
  }
  const invite = inviteSnap.data()!;
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
    if (!alreadyApproved) {
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
      !alreadyApproved &&
      licenseRef &&
      licenseSnap?.exists &&
      licenseSnap.data()?.status === "unassigned" &&
      !alreadyLicensedFor(recipientSnap!, bookId)
    ) {
      applyLicenseGrant({
        transaction,
        licenseRef,
        recipientRef,
        recipientSnap: recipientSnap!,
        bookId,
        licenseId: candidateLicenseId!,
        groupId,
        recipientEmail: email,
        now: Date.now(),
      });
      licenseGranted = true;
      grantedLicenseId = candidateLicenseId;
    }

    if (invite.status !== "accepted") {
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
