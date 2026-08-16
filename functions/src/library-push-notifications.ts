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
 * read here via the Admin SDK, which bypasses rules. Only the
 * sendLibraryUserMessage callable (library-users.functions.ts) needs this
 * in this codebase - unlike the source app, this codebase does not also
 * host the group-chat/prayer-request/conversation Firestore triggers that
 * send the OTHER kinds of push the source app's own copy of this file
 * backs, so getApprovedMemberEmails and the group-specific PushPayload
 * fields were left out of this port rather than copied unused - add them
 * back if/when a future slice ports those triggers too.
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
    data: {route: payload.route, type: payload.type},
    android: payload.collapseKey ?
      {collapseKey: payload.collapseKey} :
      {},
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
