import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import {getFirestore} from "firebase-admin/firestore";
import {
  escapeHtml,
  queueGroupInviteEmail,
} from "./transactional-emails";
import {normalizeGroupLocation} from "./library-group-location";
import {
  ApproveGroupMembershipRequest,
  ApproveGroupMembershipResult,
  CancelGroupInviteRequest,
  CancelGroupInviteResult,
  CloseMyGroupRequest,
  CloseMyGroupResult,
  CreateGroupRequest,
  CreateGroupResult,
  RejectGroupMembershipRequest,
  RejectGroupMembershipResult,
  RequestToJoinGroupRequest,
  RequestToJoinGroupResult,
  SendGroupInviteRequest,
  SendGroupInviteResult,
} from "./common/shared/contract/library-callables.types";

/**
 * Phase 6 port of the reader app's Impact Groups MEMBERSHIP write surface
 * (DiscussionGroupService/GroupInviteService): create group, request to
 * join, approve/reject a request, close a group, send/cancel an invite.
 * Per the offline-preserving split, the interactive CONTENT writes (chat,
 * prayer requests, 1:1 conversation messages) deliberately stay direct
 * client writes - membership mutations affect other people's access and
 * belong server-side; a chat message is own-authored content whose
 * instant local echo matters.
 *
 * Hardening over the client versions, beyond just moving the writes:
 * - Caller identity comes exclusively from the Auth token.
 * - createGroup writes the group doc + the creator's own approved
 *   membership doc in ONE atomic batch - the old client flow needed two
 *   sequential writes with a best-effort rollback purely because
 *   firestore.rules can't see a sibling doc from an uncommitted batch;
 *   the Admin SDK has no such constraint, so the orphaned-group failure
 *   mode is gone.
 * - sendGroupInvite derives leaderEmail/leaderDisplayName/groupTitle/
 *   bookId from the GROUP DOC (after verifying the caller is its
 *   creator), rather than trusting client-supplied copies of any of
 *   them.
 */
const db = getFirestore();

/** Patron-authored free-text ceiling, matching firestore.rules' own
 *  4000-char convention for this feature. */
const TEXT_MAX = 4000;

/**
 * Extracts the caller's normalized email or throws.
 * @param {CallableRequest} request The callable request.
 * @return {string} Verified caller email.
 */
function callerEmail(request: CallableRequest): string {
  const email = request.auth?.token.email?.trim().toLowerCase();
  if (!email) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  return email;
}

/**
 * Loads a group and asserts the caller is its creator - the
 * authorization model for every leader-only action below. Same contract
 * as library-group-licenses.functions.ts's own requireGroupLeader (local
 * copy: that one isn't exported, and the two files' error texts differ
 * deliberately per action).
 * @param {string} email The caller's verified email.
 * @param {string} groupId The group's id.
 * @return {Promise<FirebaseFirestore.DocumentData>} The group's data.
 */
async function requireCreator(
  email: string,
  groupId: string
): Promise<FirebaseFirestore.DocumentData> {
  const snap = await db.collection("discussionGroups").doc(groupId).get();
  const group = snap.data();
  if (!snap.exists || !group) {
    throw new HttpsError("not-found", "Impact Group not found.");
  }
  if (group.creatorEmail !== email) {
    throw new HttpsError(
      "permission-denied",
      "Only this Impact Group's leader can do that."
    );
  }
  return group;
}

/**
 * Trimmed, capped string or undefined - free text from clients is never
 * written unbounded.
 * @param {unknown} value The raw client value.
 * @param {number} [max] Character ceiling.
 * @return {string | undefined} Cleaned string, or undefined.
 */
function cleanText(value: unknown, max = TEXT_MAX): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

/** Creates a group + the creator's own approved membership atomically. */
export const createGroup = onCall(async (request):
  Promise<CreateGroupResult> => {
  const email = callerEmail(request);
  const data = (request.data ?? {}) as Partial<CreateGroupRequest>;

  const bookId = cleanText(data.bookId, 200);
  const title = cleanText(data.title, 200);
  const creatorDisplayName = cleanText(data.creatorDisplayName, 100) ?? email;
  const startDate = typeof data.startDate === "number" ? data.startDate : 0;
  const startTimeZone = cleanText(data.startTimeZone, 100);
  const groupVisibility =
    data.groupVisibility === "invite-only" ? "invite-only" : "public";
  const maxMembers =
    typeof data.maxMembers === "number" &&
    Number.isInteger(data.maxMembers) &&
    data.maxMembers > 0 &&
    data.maxMembers <= 1000 ?
      data.maxMembers :
      undefined;
  if (!bookId || !title || !startDate || !startTimeZone) {
    throw new HttpsError(
      "invalid-argument",
      "bookId, title, startDate and startTimeZone are required."
    );
  }

  // A group can only be STARTED around a book the creator personally holds
  // a license for; international patrons (free all-book access, never asked
  // to pay) count as licensed for every book. Deliberately NO staff bypass -
  // same choice the pre-consolidation rules' create gate made
  // (hasBookLicense || isInternationalPatron), which was lost when group
  // creation moved from a rules-gated client write to this callable.
  // `revoked` is second-layer defense: setLibraryUserRevoked also disables
  // the Auth account, but a live token can outlast that by up to an hour.
  const profileSnap =
    await db.collection("libraryUsers").doc(email).get();
  const profile = profileSnap.data() ?? {};
  if (profile.revoked === true) {
    throw new HttpsError(
      "permission-denied",
      "This account's library access has been revoked."
    );
  }

  // Whether this patron may START a group at all. The intent is that only
  // someone who has worked through all four Impact books leads one; until
  // that data exists every account carries true.
  //
  // ABSENT MEANS ALLOWED - only an explicit false withholds it, so a profile
  // written before this field existed does not lock anyone out of something
  // they could do yesterday. Read !== false, never === true.
  //
  // Checked HERE and not only in the app: the reader hides Start, Clone and
  // Promote, but a hidden button is not a control - this callable is the only
  // thing standing between the flag and a group being created.
  //
  // Gates CREATION only. Nothing else a leader does with a group they already
  // run is affected, or a live group could be stranded mid-study.
  if (profile.canLeadGroups === false) {
    throw new HttpsError(
      "permission-denied",
      "Your account is not set up to start Impact Groups."
    );
  }
  const licensed = Array.isArray(profile.licensedBookIds) &&
    profile.licensedBookIds.includes(bookId);
  if (!licensed && profile.internationalUser !== true) {
    throw new HttpsError(
      "permission-denied",
      "You need a license for this book to start an Impact Group around it."
    );
  }

  // Structured location passes through with per-field narrowing; the
  // legacy free-text inPersonLocation shape is still accepted for parity.
  const location = normalizeGroupLocation(data.location, cleanText);

  const now = Date.now();
  const groupRef = db.collection("discussionGroups").doc();
  const batch = db.batch();
  batch.set(groupRef, {
    bookId,
    title,
    ...(cleanText(data.description) ?
      {description: cleanText(data.description)} :
      {}),
    creatorEmail: email,
    creatorDisplayName,
    ...(cleanText(data.inPersonLocation, 500) ?
      {inPersonLocation: cleanText(data.inPersonLocation, 500)} :
      {}),
    ...(location ? {location} : {}),
    ...(cleanText(data.onlineInfo) ?
      {onlineInfo: cleanText(data.onlineInfo)} :
      {}),
    startDate,
    startTimeZone,
    groupVisibility,
    ...(maxMembers ? {maxMembers} : {}),
    status: "open",
    createdAt: now,
    updatedAt: now,
  });
  batch.set(groupRef.collection("members").doc(email), {
    groupId: groupRef.id,
    email,
    displayName: creatorDisplayName,
    status: "approved",
    requestedAt: now,
    respondedAt: now,
  });
  await batch.commit();
  return {groupId: groupRef.id};
});

/** Writes the caller's own 'pending' membership request. */
export const requestToJoinGroup = onCall(async (request):
  Promise<RequestToJoinGroupResult> => {
  const email = callerEmail(request);
  const {groupId} = (request.data ?? {}) as Partial<RequestToJoinGroupRequest>;
  const displayName =
    cleanText((request.data ?? {}).displayName, 100) ?? email;
  if (!groupId) {
    throw new HttpsError("invalid-argument", "groupId is required.");
  }
  const groupSnap = await db
    .collection("discussionGroups")
    .doc(groupId)
    .get();
  const groupData = groupSnap.data();
  if (!groupSnap.exists || !groupData || groupData.status !== "open") {
    throw new HttpsError(
      "failed-precondition",
      "This Impact Group is not open to join."
    );
  }
  const memberRef = groupSnap.ref.collection("members").doc(email);
  const existing = await memberRef.get();
  if (existing.exists && existing.data()?.status === "approved") {
    // Never downgrade an approved membership to pending - a double-tap
    // or stale UI must not eject someone from a group they're in.
    return {requested: false, alreadyMember: true};
  }
  await memberRef.set({
    groupId,
    email,
    displayName,
    status: "pending",
    requestedAt: Date.now(),
  });
  return {requested: true};
});

/** Creator-only: approves a pending request; auto-closes at capacity. */
export const approveGroupMembership = onCall(async (request):
  Promise<ApproveGroupMembershipResult> => {
  const email = callerEmail(request);
  const {groupId, memberEmail} =
    (request.data ?? {}) as Partial<ApproveGroupMembershipRequest>;
  if (!groupId || !memberEmail) {
    throw new HttpsError(
      "invalid-argument",
      "groupId and memberEmail are required."
    );
  }
  const group = await requireCreator(email, groupId);
  const normalized = memberEmail.trim().toLowerCase();
  const memberRef = db
    .collection("discussionGroups")
    .doc(groupId)
    .collection("members")
    .doc(normalized);
  const memberSnap = await memberRef.get();
  if (!memberSnap.exists) {
    throw new HttpsError("not-found", "No such membership request.");
  }
  await memberRef.update({status: "approved", respondedAt: Date.now()});

  // Auto-close once the approved count (excluding the creator) reaches
  // maxMembers - ported from the client, where only the creator could
  // ever run this, so there's still no concurrent-approval race worth a
  // transaction.
  const maxMembers = group.maxMembers as number | undefined;
  if (maxMembers) {
    const membersSnap = await db
      .collection("discussionGroups")
      .doc(groupId)
      .collection("members")
      .get();
    const approvedCount = membersSnap.docs.filter(
      (d) =>
        d.data().status === "approved" && d.data().email !== group.creatorEmail
    ).length;
    if (approvedCount >= maxMembers) {
      await db.collection("discussionGroups").doc(groupId).update({
        status: "closed",
        closedAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  }
  return {approved: true};
});

/** Creator-only: marks a request rejected (doc kept, not deleted, so the
 *  requester stays visible in Manage and a conversation can follow). */
export const rejectGroupMembership = onCall(async (request):
  Promise<RejectGroupMembershipResult> => {
  const email = callerEmail(request);
  const {groupId, memberEmail} =
    (request.data ?? {}) as Partial<RejectGroupMembershipRequest>;
  if (!groupId || !memberEmail) {
    throw new HttpsError(
      "invalid-argument",
      "groupId and memberEmail are required."
    );
  }
  await requireCreator(email, groupId);
  const normalized = memberEmail.trim().toLowerCase();
  const memberRef = db
    .collection("discussionGroups")
    .doc(groupId)
    .collection("members")
    .doc(normalized);
  const memberSnap = await memberRef.get();
  if (!memberSnap.exists) {
    throw new HttpsError("not-found", "No such membership request.");
  }
  await memberRef.update({status: "rejected", respondedAt: Date.now()});
  return {rejected: true};
});

/** Creator-only: soft-close (document + members kept, hidden from the
 *  open browse list). */
export const closeMyGroup = onCall(async (request):
  Promise<CloseMyGroupResult> => {
  const email = callerEmail(request);
  const {groupId} = (request.data ?? {}) as Partial<CloseMyGroupRequest>;
  if (!groupId) {
    throw new HttpsError("invalid-argument", "groupId is required.");
  }
  await requireCreator(email, groupId);
  await db.collection("discussionGroups").doc(groupId).update({
    status: "closed",
    closedAt: Date.now(),
    updatedAt: Date.now(),
  });
  return {closed: true};
});

/** Creator-only: sends an invite. Group title/book/leader fields derive
 *  from the group doc, never from the client. */
export const sendGroupInvite = onCall(async (request):
  Promise<SendGroupInviteResult> => {
  const email = callerEmail(request);
  const {groupId, inviteeEmail, licenseIntent, bookTitle} =
    (request.data ?? {}) as Partial<SendGroupInviteRequest>;
  const invitee = (inviteeEmail ?? "").trim().toLowerCase();
  if (!groupId || !invitee || !invitee.includes("@")) {
    throw new HttpsError(
      "invalid-argument",
      "groupId and a valid inviteeEmail are required."
    );
  }
  const group = await requireCreator(email, groupId);
  const leaderDisplayName =
    (group.creatorDisplayName as string | undefined) ?? email;
  const ref = await db.collection("groupInvites").add({
    groupId,
    groupTitle: group.title,
    bookId: group.bookId,
    leaderEmail: email,
    leaderDisplayName,
    inviteeEmail: invitee,
    licenseIntent: licenseIntent === true,
    status: "pending",
    createdAt: Date.now(),
  });

  // Pre-prod #1: the invite email is queued here now (the reader's
  // InviteMemberDialogComponent no longer writes `mail`). Meeting details
  // come from the GROUP DOC, not the client; bookTitle is display-only
  // text and HTML-escaped by the builder. Best-effort - the invite doc
  // above already saved, and the dialog still shows success either way.
  try {
    await queueGroupInviteEmail(
      db,
      invitee,
      ref.id,
      leaderDisplayName,
      (group.title as string | undefined) ?? "Impact Group",
      typeof bookTitle === "string" ? bookTitle.slice(0, 200) : "",
      buildMeetingLine(group)
    );
  } catch (mailErr) {
    console.error("Failed to queue group invite email", mailErr);
  }

  return {inviteId: ref.id};
});

/**
 * "When/where" line for the invite email - server-side equivalent of the
 * reader's formatGroupDateTime + groupLocationLabel composition. Returns
 * pre-escaped HTML (each part is escaped individually).
 * @param {Record<string, unknown>} group The group doc's data.
 * @return {string} Escaped meeting-details line.
 */
function buildMeetingLine(group: Record<string, unknown>): string {
  const parts: string[] = [];
  const startDate = group.startDate;
  if (typeof startDate === "number") {
    const zone = typeof group.startTimeZone === "string" ?
      group.startTimeZone : "America/New_York";
    try {
      parts.push(escapeHtml(new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(new Date(startDate))));
    } catch {
      parts.push(escapeHtml(new Date(startDate).toUTCString()));
    }
  }
  const location = group.location as Record<string, unknown> | undefined;
  if (location) {
    const locParts: string[] = [];
    if (location.addressVisible && typeof location.address1 === "string") {
      locParts.push(location.address1);
    }
    if (typeof location.city === "string") {
      locParts.push(location.city);
    }
    if (typeof location.state === "string" && location.state) {
      locParts.push(location.state);
    }
    if (typeof location.country === "string" && location.country !== "US") {
      locParts.push(location.country);
    }
    if (locParts.length > 0) {
      parts.push(escapeHtml(locParts.join(", ")));
    }
  }
  if (typeof group.onlineInfo === "string" && group.onlineInfo) {
    parts.push("Online: " + escapeHtml(group.onlineInfo));
  }
  return parts.length > 0 ? parts.join(" | ") : "Details to follow";
}

/** Cancels the caller's own still-pending invite - accepted/declined
 *  invites stay as historical records. */
export const cancelGroupInvite = onCall(async (request):
  Promise<CancelGroupInviteResult> => {
  const email = callerEmail(request);
  const {inviteId} = (request.data ?? {}) as Partial<CancelGroupInviteRequest>;
  if (!inviteId) {
    throw new HttpsError("invalid-argument", "inviteId is required.");
  }
  const ref = db.collection("groupInvites").doc(inviteId);
  const snap = await ref.get();
  const invite = snap.data();
  if (!snap.exists || !invite) {
    throw new HttpsError("not-found", "Invite not found.");
  }
  if (invite.leaderEmail !== email) {
    throw new HttpsError(
      "permission-denied",
      "This invite does not belong to you."
    );
  }
  if (invite.status !== "pending") {
    throw new HttpsError(
      "failed-precondition",
      "Only a pending invite can be cancelled."
    );
  }
  await ref.delete();
  return {cancelled: true};
});
