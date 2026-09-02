import {tenantPath, triggerPath} from "./common/shared/lists/tenancy";
const GROUPS = tenantPath("discussionGroups");
import {
  onDocumentCreated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {getMessaging} from "firebase-admin/messaging";
import * as logger from "firebase-functions/logger";
import {getApp} from "firebase-admin/app";
import {
  getApprovedMemberEmails,
  sendLibraryPushToUser,
  truncate,
} from "./library-push-notifications";

/**
 * Ported from impact-discipleship-library-manager-new's own push-
 * notification Firestore triggers (functions/src/index.ts) - group chat,
 * 1:1 conversations, join requests, and prayer requests, plus the
 * memberCount/pendingCount denormalization trigger the Library Groups
 * admin screen's table reads. `discussionGroups` was migrated to THIS
 * project's own default database (Phase 3 migration target), so every
 * trigger below now uses the plain string document-path form (no
 * `database:` option) - the same convention every other default-db
 * trigger in this codebase already uses. (Previously each one had to pass
 * `database: 'impactdiscipleship-books'` or silently bind to the empty
 * "(default)" database and never fire - that's no longer relevant now
 * that "(default)" IS the database this data actually lives in.)
 */
const libraryDb = getFirestore();
const messaging = getMessaging(getApp());

/** One group-doc read shared by every trigger - title for the
 *  notification heading, creatorEmail for leader-addressed events.
 * @param {string} groupId The Impact Group's id.
 * @return {Promise<{title: string, creatorEmail: string} | null>} Group
 * summary, or null if the group doesn't exist.
 */
async function getGroupForPush(
  groupId: string
): Promise<{ title: string; creatorEmail: string } | null> {
  const snap = await libraryDb
    .collection(GROUPS)
    .doc(groupId)
    .get();
  const data = snap.data();
  if (!snap.exists || !data) {
    return null;
  }
  return {
    title: data.title as string,
    creatorEmail: (data.creatorEmail as string).toLowerCase(),
  };
}

/** Group chat message -> every approved member except the sender. */
export const notifyGroupChatMessage = onDocumentCreated(
  triggerPath("discussionGroups", "{groupId}/chatMessages/{messageId}"),
  async (event) => {
    const message = event.data?.data();
    if (!message) {
      return;
    }
    const {groupId} = event.params;
    const group = await getGroupForPush(groupId);
    if (!group) {
      return;
    }
    const recipients = await getApprovedMemberEmails(
      libraryDb,
      groupId,
      message.senderEmail as string
    );
    await Promise.all(
      recipients.map((email) =>
        sendLibraryPushToUser(libraryDb, messaging, email, {
          title:
            `${group.title}: New message from ${message.senderDisplayName}`,
          body: truncate(message.text as string),
          route: `/groups/${groupId}/chat`,
          type: "group-chat",
          groupId,
          collapseKey: `chat-${groupId}`,
        })
      )
    );
  }
);

/** 1:1 leader<->member conversation message -> the other party. The
 *  conversation doc id ({otherEmail}) is always the NON-creator side's
 *  email, so: member sent it -> notify the creator; creator sent it ->
 *  notify the member. */
export const notifyConversationMessage = onDocumentCreated(
  triggerPath("discussionGroups",
    "{groupId}/conversations/{otherEmail}/messages/{messageId}"),
  async (event) => {
    const message = event.data?.data();
    if (!message) {
      return;
    }
    const {groupId, otherEmail} = event.params;
    const conversationId = otherEmail.toLowerCase();
    const sender = (message.senderEmail as string).toLowerCase();
    const group = await getGroupForPush(groupId);
    if (!group) {
      return;
    }
    let recipient: string;
    if (sender === conversationId) {
      recipient = group.creatorEmail;
    } else if (sender === group.creatorEmail) {
      recipient = conversationId;
    } else {
      // Shouldn't happen (rules restrict writers to the two participants) -
      // log rather than guess at a recipient.
      logger.warn("conversation message sender is neither participant", {
        groupId,
        conversationId,
        sender,
      });
      return;
    }
    await sendLibraryPushToUser(libraryDb, messaging, recipient, {
      title: `${message.senderDisplayName} (${group.title})`,
      body: truncate(message.text as string),
      route: `/groups/${groupId}/messages/${conversationId}`,
      type: "conversation",
      groupId,
      collapseKey: `dm-${groupId}-${conversationId}`,
    });
  }
);

/**
 * Maintains discussionGroups/{groupId}.memberCount/pendingCount as
 * members are added/approved/rejected/removed, instead of the admin
 * Groups table computing them by querying every membership doc across
 * every group on every page load. FieldValue.increment() rather than a
 * read-modify-write transaction - Firestore applies increments atomically
 * server-side regardless of write ordering.
 */
export const onGroupMembershipCountChanged = onDocumentWritten(
  triggerPath("discussionGroups", "{groupId}/members/{email}"),
  async (event) => {
    const beforeStatus = event.data?.before.exists ?
      (event.data.before.data()?.status as string | undefined) :
      undefined;
    const afterStatus = event.data?.after.exists ?
      (event.data.after.data()?.status as string | undefined) :
      undefined;
    if (beforeStatus === afterStatus) {
      return;
    }

    const delta: Record<string, number> = {};
    const bump = (status: string | undefined, amount: number) => {
      if (status === "approved") {
        delta.memberCount = (delta.memberCount ?? 0) + amount;
      } else if (status === "pending") {
        delta.pendingCount = (delta.pendingCount ?? 0) + amount;
      }
    };
    bump(beforeStatus, -1);
    bump(afterStatus, 1);

    const updates: Record<string, FirebaseFirestore.FieldValue> = {};
    for (const [field, amount] of Object.entries(delta)) {
      if (amount !== 0) {
        updates[field] = FieldValue.increment(amount);
      }
    }
    if (Object.keys(updates).length === 0) {
      return;
    }

    const {groupId} = event.params;
    try {
      await libraryDb.doc(`${GROUPS}/${groupId}`).update(updates);
    } catch (err) {
      // The group itself may have just been hard-deleted (Groups admin's
      // deleteGroup removes members before the group doc) - nothing to
      // update in that case, not a real failure.
      logger.warn(
        "onGroupMembershipCountChanged: could not update " +
          `discussionGroups/${groupId}`,
        err
      );
    }
  }
);

/** Join-request lifecycle. Only two transitions notify:
 *  - create WITH status 'pending' (requestToJoin) -> the group's leader;
 *  - update 'pending' -> 'approved'|'rejected' -> the requester.
 *  Everything else stays silent on purpose: the creator's own doc,
 *  copyGroupMembers clones, and acceptGroupInvite all CREATE docs already
 *  'approved' (a bulk clone must not spam), and deletes are leave/remove. */
export const notifyJoinRequestActivity = onDocumentWritten(
  triggerPath("discussionGroups", "{groupId}/members/{email}"),
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;
    if (!after?.exists) {
      return;
    }
    const {groupId, email} = event.params;
    const afterStatus = after.data()?.status as string;

    if (!before?.exists) {
      if (afterStatus !== "pending") {
        return;
      }
      const group = await getGroupForPush(groupId);
      if (!group) {
        return;
      }
      await sendLibraryPushToUser(libraryDb, messaging, group.creatorEmail, {
        title: group.title,
        body: `${after.data()?.displayName ?? email} requested to join`,
        route: `/groups/${groupId}/members`,
        type: "join-request",
        groupId,
      });
      return;
    }

    const beforeStatus = before.data()?.status as string;
    if (
      beforeStatus !== "pending" ||
      (afterStatus !== "approved" && afterStatus !== "rejected")
    ) {
      return;
    }
    const group = await getGroupForPush(groupId);
    if (!group) {
      return;
    }
    await sendLibraryPushToUser(libraryDb, messaging, email, {
      title: group.title,
      body:
        afterStatus === "approved" ?
          "Your request to join was approved" :
          "Your request to join was not approved",
      route: `/groups/${groupId}/overview`,
      type: "join-request",
      groupId,
    });
  }
);

/** Prayer request shared into a group -> every approved member except the
 *  author. shareGroupPrayerRequest fans one submission out across
 *  multiple groups as separate docs, so this fires once per group -
 *  correct, each group's members get their own group-titled
 *  notification. */
export const notifyPrayerRequestShared = onDocumentCreated(
  triggerPath("discussionGroups", "{groupId}/prayerRequests/{requestId}"),
  async (event) => {
    const prayer = event.data?.data();
    if (!prayer) {
      return;
    }
    const {groupId} = event.params;
    const group = await getGroupForPush(groupId);
    if (!group) {
      return;
    }
    const recipients = await getApprovedMemberEmails(
      libraryDb,
      groupId,
      prayer.authorEmail as string
    );
    await Promise.all(
      recipients.map((email) =>
        sendLibraryPushToUser(libraryDb, messaging, email, {
          title:
            `${group.title}: Prayer request from ` +
            `${prayer.authorDisplayName}`,
          body: truncate(prayer.text as string),
          route: `/groups/${groupId}/prayer-requests`,
          type: "prayer-request",
          groupId,
          collapseKey: `prayer-${groupId}`,
        })
      )
    );
  }
);
