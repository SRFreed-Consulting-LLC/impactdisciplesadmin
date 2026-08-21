import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {
  DeleteMyAccountResult,
} from "./common/shared/contract/library-callables.types";

/**
 * Self-service account deletion for the reader app (Settings > Account >
 * Delete account) - required by Google Play's account-deletion policy.
 *
 * Phase 6 port of the reader's AccountDeletionService client-side cascade:
 * the ~7 sequential client writes were an interruptible sequence (close
 * the tab halfway and the account is half-deleted), and every one of them
 * needed a firestore.rules allowance that existed only for this flow.
 * Server-side, the cascade runs to completion once started, needs no
 * client-write rules at all, and can use recursiveDelete (which also
 * covers any subcollection added later without touching this function).
 *
 * The client still reauthenticates with the password FIRST (proof of
 * identity / "are you really sure") before calling this - the server
 * trusts the resulting fresh Auth session.
 *
 * Deletes: the libraryUsers profile doc + every subcollection
 * (lessonStatus/lessonHighlights/fcmTokens/messages/submissions),
 * membership docs across every group, un-answered invites they sent, and
 * the Firebase Auth account (last). Groups they created are soft-closed,
 * never hard-deleted - other members keep their shared history. Retained
 * on purpose: chat/1:1 messages already sent (group content others may
 * still be replying to), purchase records (transaction audit trail -
 * Play policy explicitly permits retaining these), and any group
 * licenses they bought (already-assigned members keep their books).
 */
const db = admin.firestore();

export const deleteMyAccount = onCall(async (request):
  Promise<DeleteMyAccountResult> => {
  const email = request.auth?.token.email?.trim().toLowerCase();
  const uid = request.auth?.uid;
  if (!email || !uid) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }

  // 1. Groups this patron created: soft-close. Groups they joined:
  // delete the membership doc itself.
  const writer = db.bulkWriter();
  const createdGroups = await db
    .collection("discussionGroups")
    .where("creatorEmail", "==", email)
    .get();
  for (const groupDoc of createdGroups.docs) {
    writer.update(groupDoc.ref, {status: "closed", updatedAt: Date.now()});
  }
  const memberships = await db
    .collectionGroup("members")
    .where("email", "==", email)
    .get();
  for (const memberDoc of memberships.docs) {
    writer.delete(memberDoc.ref);
  }

  // 2. Un-answered invites they sent (accepted/declined ones are kept as
  // historical records).
  const invites = await db
    .collection("groupInvites")
    .where("leaderEmail", "==", email)
    .where("status", "==", "pending")
    .get();
  for (const inviteDoc of invites.docs) {
    writer.delete(inviteDoc.ref);
  }
  await writer.close();

  // 3. The profile doc + ALL its subcollections in one recursive pass.
  await db.recursiveDelete(db.collection("libraryUsers").doc(email));

  // 4. The Auth account itself, last - tolerant of an already-missing
  // account so a retry after a partial failure still converges.
  try {
    await admin.auth().deleteUser(uid);
  } catch (err) {
    if ((err as {code?: string}).code !== "auth/user-not-found") {
      throw err;
    }
  }

  logger.info("Reader account deleted", {
    email,
    closedGroups: createdGroups.size,
    removedMemberships: memberships.size,
    removedInvites: invites.size,
  });
  return {deleted: true};
});
