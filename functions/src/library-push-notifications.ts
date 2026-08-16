import {Firestore} from "firebase-admin/firestore";
import {Messaging} from "firebase-admin/messaging";
import * as logger from "firebase-functions/logger";

/**
 * Ported from impact-discipleship-library-manager-new's
 * push-notifications.ts - send-side logic for a push notification to a
 * reader-app library user. Receive-side lives in the reader app's
 * PushNotificationService, which registers device tokens under
 * libraryUsers/{email}/fcmTokens/{token} in the named
 * 'impactdiscipleship-books' database - owner-only under firestore.rules,
 * read here via the Admin SDK, which bypasses rules. Originally ported
 * (Slice 4) just far enough for sendLibraryUserMessage; extended to the
 * source's full surface (getApprovedMemberEmails, the `groupId` payload
 * field) once the group-chat/prayer-request/conversation/join-request
 * Firestore triggers were ported too (library-group-notifications.functions.ts)
 * - see that file for the callers.
 *
 * Message shape is a notification+data hybrid: the `notification` block
 * lets Android auto-display in the tray while the app is
 * backgrounded/killed, while the `data` block rides along to the reader
 * app's own tap-to-navigate handling. All data values must be strings (FCM
 * requirement). Notification text is English-only for now.
 */
export interface LibraryPushPayload {
  title: string;
  body: string;
  /** In-app route the reader navigates to on tap, e.g. /messages. */
  route: string;
  /** Event discriminator, e.g. 'admin-message' - for future client
   *  filtering. */
  type: string;
  /** Present on every group-sourced push; absent for admin announcements
   *  (sendLibraryUserMessage). Omitted from the FCM `data` block when
   *  absent - FCM requires every data value to be a string, so it can't
   *  ride along as undefined/''. */
  groupId?: string;
  /** Set for bursty sources so a device that was offline shows one
   *  collapsed notification per stream, not the whole backlog. */
  collapseKey?: string;
}

/** Where the reader app is served from - browser (web-push) notification
 *  clicks open `<origin><route>` via webpush.fcmOptions.link below, which
 *  FCM requires to be an absolute https URL. Must change at the eventual
 *  impactdisciples-a82a8 production cutover, same as this project's own
 *  Firebase config. */
const READER_APP_ORIGIN = "https://impactdisciplesdev-library.web.app";

/**
 * Truncates `text` to `max` characters, appending an ellipsis if it was
 * cut - used to keep a push notification body short even when the
 * underlying message is long.
 * @param {string} text Text to truncate.
 * @param {number} max Maximum length before truncating (default 100).
 * @return {string} The (possibly truncated) text.
 */
export function truncate(text: string, max = 100): string {
  const trimmed = (text ?? "").trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/** Token delete is only safe when FCM says the TOKEN itself is bad - a
 *  transient send failure (unavailable/internal) must never purge a live
 *  device registration. */
const DEAD_TOKEN_CODES = [
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
];

/**
 * Sends `payload` to every registered device of `email`. Returns the
 * number of successful sends; 0 (silently) when the recipient has opted
 * out (notificationsEnabled === false - ABSENT means enabled) or has no
 * registered devices. Deletes token docs FCM reports as dead.
 * @param {Firestore} db The named 'impactdiscipleship-books' database
 * handle.
 * @param {Messaging} messaging The Admin SDK Messaging instance.
 * @param {string} email The recipient's library user email (doc id).
 * @param {LibraryPushPayload} payload The notification to send.
 * @return {Promise<number>} Count of devices the push was actually sent
 * to.
 */
export async function sendLibraryPushToUser(
  db: Firestore,
  messaging: Messaging,
  email: string,
  payload: LibraryPushPayload
): Promise<number> {
  const normalized = email.trim().toLowerCase();
  const userRef = db.collection("libraryUsers").doc(normalized);
  const userSnap = await userRef.get();
  if (userSnap.data()?.notificationsEnabled === false) {
    return 0;
  }
  const tokensSnap = await userRef.collection("fcmTokens").get();
  if (tokensSnap.empty) {
    return 0;
  }
  const tokens = tokensSnap.docs.map((d) => d.id);
  const result = await messaging.sendEachForMulticast({
    tokens,
    notification: {title: payload.title, body: payload.body},
    data: {
      route: payload.route,
      type: payload.type,
      ...(payload.groupId ? {groupId: payload.groupId} : {}),
    },
    android: payload.collapseKey ? {collapseKey: payload.collapseKey} : {},
    webpush: {
      fcmOptions: {link: `${READER_APP_ORIGIN}${payload.route}`},
    },
  });
  await Promise.all(
    result.responses.map((response, i) => {
      if (response.success) {
        return Promise.resolve();
      }
      const code = response.error?.code ?? "";
      if (DEAD_TOKEN_CODES.includes(code)) {
        return tokensSnap.docs[i].ref.delete();
      }
      logger.warn(`push send to ${normalized} failed (token kept)`, {
        code,
        message: response.error?.message,
      });
      return Promise.resolve();
    })
  );
  return result.successCount;
}

/**
 * Emails (doc ids) of every APPROVED member of the group, minus
 * `excludeEmail` (the sender/author - never notify someone about their
 * own action). Member doc ids are already lowercased emails by
 * convention.
 * @param {Firestore} db The named 'impactdiscipleship-books' database
 * handle.
 * @param {string} groupId The Impact Group's id.
 * @param {string} excludeEmail The sender/author to exclude.
 * @return {Promise<string[]>} Approved member emails, minus the excluded one.
 */
export async function getApprovedMemberEmails(
  db: Firestore,
  groupId: string,
  excludeEmail: string
): Promise<string[]> {
  const excluded = excludeEmail.trim().toLowerCase();
  // .select() with no fields - only the doc id (already the email, by
  // convention) is ever used, so this trims the whole membership doc off
  // the wire on every chat message / prayer-request share, not just the
  // `status` filter field.
  const snap = await db
    .collection("discussionGroups")
    .doc(groupId)
    .collection("members")
    .where("status", "==", "approved")
    .select()
    .get();
  return snap.docs
    .map((d) => d.id)
    .filter((memberEmail) => memberEmail !== excluded);
}
