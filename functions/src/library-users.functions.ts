import {tenantPath} from "./common/shared/lists/tenancy";
const ADMIN_MESSAGES = tenantPath("adminMessages");
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {FieldPath, FieldValue, getFirestore} from "firebase-admin/firestore";
import {getMessaging} from "firebase-admin/messaging";
import {requireAdminRole} from "./admin-users.functions";
import {sendLibraryPushToUser, truncate} from "./library-push-notifications";
import {getAuth} from "firebase-admin/auth";
import {getApp} from "firebase-admin/app";
import {
  GrantLibraryUserLicensesRequest,
  GrantLibraryUserLicensesResult,
  RevokeAdminGrantedLicenseRequest,
  RevokeAdminGrantedLicenseResult,
  SendLibraryUserMessageRequest,
  SendLibraryUserMessageResult,
  SetLibraryUserRevokedRequest,
  SetLibraryUserRevokedResult,
  UpdateLibraryUserRequest,
  UpdateLibraryUserResult,
} from "./common/shared/contract/admin-callables.types";

/**
 * Ported from impact-discipleship-library-manager-new's own Library Users
 * admin Cloud Functions (functions/src/index.ts). All five callables exist
 * because firestore.rules scopes libraryUsers writes to the owner's own
 * email - an admin's client session can never write another user's doc, so
 * every admin mutation must run here with the Admin SDK. libraryUsers doc
 * ids are lowercased emails, so every function normalizes the same way.
 *
 * Reads/writes THIS project's own default database (Phase 3 migration
 * target) - libraryUsers/adminMessages were migrated here alongside every
 * other Library-owned/reader-owned collection, so this no longer needs the
 * named 'impactdiscipleship-books' database - see libraryDb below.
 * `books` is nested (librarySeries/{s}/books/{b}), so the one book lookup
 * below goes through a `collectionGroup('books')` scan matched by doc id,
 * same pattern this app's own LibraryBookService.getById() uses.
 *
 * Adapted from the source, not a verbatim copy:
 * - requireAdmin -> requireAdminRole (this app's own admin_users, matched
 *   by firebaseUID, not the source app's uid-keyed adminUsers).
 * - sendLibraryUserMessage's sender-display-name lookup queries this app's
 *   own admin_users the same way requireAdminRole does, instead of the
 *   source's db.collection('adminUsers').doc(uid).
 * - withErrorLogging isn't used here, matching every other function in
 *   this codebase (admin-users.functions.ts, book-import.functions.ts) -
 *   this codebase has no equivalent wrapper.
 */
const libraryDb = getFirestore();
const messaging = getMessaging(getApp());

const LIBRARY_USER_EDITABLE_FIELDS = [
  "firstName",
  "lastName",
  "phone",
  "internationalUser",
] as const;
type LibraryUserEditableField = (typeof LIBRARY_USER_EDITABLE_FIELDS)[number];

/**
 * Admin edit of a library user's low-stakes profile fields. Strict
 * allowlist: licenses have their own grant/revoke functions below,
 * `revoked` its own function, and personal preferences (darkMode, themes,
 * preferredLanguage, notificationsEnabled) stay the user's own - the
 * reader app would overwrite an admin's value on their next save anyway.
 */
export const updateLibraryUser = onCall(async (request):
  Promise<UpdateLibraryUserResult> => {
  await requireAdminRole(request.auth?.uid);

  const {email, ...fields} =
    (request.data ?? {}) as Partial<UpdateLibraryUserRequest>;
  if (!email) {
    throw new HttpsError("invalid-argument", "email is required.");
  }
  // correlationId (attachCorrelationId's client-side error-correlation
  // marker) rides along on every call but isn't itself editable - excluded
  // here rather than rejected as an unknown field.
  const unknownKeys = Object.keys(fields).filter(
    (key) =>
      key !== "correlationId" &&
      !LIBRARY_USER_EDITABLE_FIELDS.includes(key as LibraryUserEditableField)
  );
  if (unknownKeys.length > 0) {
    throw new HttpsError(
      "invalid-argument",
      `Not admin-editable: ${unknownKeys.join(", ")}`
    );
  }
  const updates: Record<string, string | boolean> = {};
  for (const key of LIBRARY_USER_EDITABLE_FIELDS) {
    if (!(key in fields)) {
      continue;
    }
    const value = fields[key];
    const expected = key === "internationalUser" ? "boolean" : "string";
    if (typeof value !== expected) {
      throw new HttpsError("invalid-argument", `${key} must be a ${expected}.`);
    }
    updates[key] = value as string | boolean;
  }
  if (Object.keys(updates).length === 0) {
    throw new HttpsError("invalid-argument", "Nothing to update.");
  }

  const normalized = email.trim().toLowerCase();
  const ref = libraryDb.collection("libraryUsers").doc(normalized);
  await libraryDb.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) {
      throw new HttpsError(
        "not-found",
        "No library user record for that email."
      );
    }
    transaction.set(
      ref,
      {...updates, updatedAt: Date.now()},
      {merge: true}
    );
  });
  return {email: normalized};
});

/**
 * Reversible access revocation ("disable access, keep data"): disables (or
 * re-enables) the Firebase Auth account and stamps the `revoked` flag on
 * the libraryUsers doc. Auth first, doc second - a failure can leave the
 * flag unset with the account already disabled (harmless; retry), never a
 * doc claiming revoked while sign-in still works. Tolerates a missing Auth
 * account (legacy-import docs) - returns authAccountFound so the UI can
 * say so. On revoke, refresh tokens are also revoked so live sessions
 * can't renew.
 */
export const setLibraryUserRevoked = onCall(async (request):
  Promise<SetLibraryUserRevokedResult> => {
  await requireAdminRole(request.auth?.uid);
  // requireAdminRole throws for a missing/invalid uid, so request.auth is
  // genuinely defined below -- this makes that explicit for TypeScript
  // too, rather than asserting it at each later usage site.
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }

  const {email, revoked} =
    (request.data ?? {}) as Partial<SetLibraryUserRevokedRequest>;
  if (!email || typeof revoked !== "boolean") {
    throw new HttpsError("invalid-argument", "email and revoked are required.");
  }
  const normalized = email.trim().toLowerCase();
  const ref = libraryDb.collection("libraryUsers").doc(normalized);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "No library user record for that email.");
  }

  let authAccountFound = true;
  try {
    const userRecord = await getAuth().getUserByEmail(normalized);
    await getAuth().updateUser(userRecord.uid, {disabled: revoked});
    if (revoked) {
      await getAuth().revokeRefreshTokens(userRecord.uid);
    }
  } catch (err) {
    if ((err as { code?: string }).code === "auth/user-not-found") {
      authAccountFound = false;
    } else {
      throw err;
    }
  }

  const now = Date.now();
  await ref.set(
    revoked ?
      {
        revoked: true,
        revokedAt: now,
        revokedBy: request.auth.uid,
        updatedAt: now,
      } :
      {
        revoked: false,
        revokedAt: FieldValue.delete(),
        revokedBy: FieldValue.delete(),
        updatedAt: now,
      },
    {merge: true}
  );
  return {email: normalized, revoked, authAccountFound};
});

/**
 * Admin-comped book licenses - the no-payment counterpart of a real
 * purchase, writing the same bookLicenses/licensedBookIds pair. Entries
 * carry `source: 'admin-grant'` + grantedBy so they're distinguishable
 * from purchase-origin (no source) and group-license entries - each kind
 * has its own revocation path. Already-covered books are skipped, never
 * overwritten (a grant must not destroy purchase provenance). May create
 * the doc (pre-grant before first sign-in) but never writes `userId`.
 */
export const grantLibraryUserLicenses = onCall(async (request):
  Promise<GrantLibraryUserLicensesResult> => {
  await requireAdminRole(request.auth?.uid);
  // requireAdminRole throws for a missing/invalid uid, so request.auth is
  // genuinely defined below -- this makes that explicit for TypeScript
  // too, rather than asserting it at each later usage site.
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }

  const {email, bookIds} =
    (request.data ?? {}) as Partial<GrantLibraryUserLicensesRequest>;
  if (
    !email ||
    !Array.isArray(bookIds) ||
    bookIds.length === 0 ||
    bookIds.some((id) => typeof id !== "string" || !id)
  ) {
    throw new HttpsError(
      "invalid-argument",
      "email and a non-empty bookIds array are required."
    );
  }
  const uniqueBookIds = Array.from(new Set(bookIds));
  // A bare book id doesn't say which series/book it's nested under - scans
  // every series' `books` subcollection once via a collectionGroup query
  // rather than one lookup per id. Fine at this library's real scale (a
  // handful of books total).
  const knownBookIds = new Set(
    (await libraryDb.collectionGroup("books").get()).docs.map((d) => d.id)
  );
  const missing = uniqueBookIds.filter((id) => !knownBookIds.has(id));
  if (missing.length > 0) {
    throw new HttpsError("not-found", `No such book(s): ${missing.join(", ")}`);
  }

  const normalized = email.trim().toLowerCase();
  const ref = libraryDb.collection("libraryUsers").doc(normalized);
  const now = Date.now();
  let granted: string[] = [];
  let skipped: string[] = [];
  await libraryDb.runTransaction(async (transaction) => {
    granted = [];
    skipped = [];
    const snap = await transaction.get(ref);
    const data = snap.exists ?
      (snap.data() as {
          bookLicenses?: Record<string, unknown>[];
          licensedBookIds?: string[];
        }) :
      undefined;
    // Array.isArray guards: legacy docs can carry the 'all' string
    // sentinel in licensedBookIds - spreading a string would explode it
    // into chars.
    const bookLicenses = Array.isArray(data?.bookLicenses) ?
      [...data.bookLicenses] :
      [];
    for (const bookId of uniqueBookIds) {
      if (bookLicenses.some((license) => license["bookId"] === bookId)) {
        skipped.push(bookId);
        continue;
      }
      bookLicenses.push({
        bookId,
        purchaseDate: now,
        source: "admin-grant",
        grantedBy: request.auth.uid,
      });
      granted.push(bookId);
    }
    if (granted.length === 0) {
      return;
    }
    const priorIds = Array.isArray(data?.licensedBookIds) ?
      data.licensedBookIds :
      [];
    const licensedBookIds = Array.from(new Set([...priorIds, ...granted]));
    transaction.set(
      ref,
      {
        email: normalized,
        bookLicenses,
        licensedBookIds,
        updatedAt: now,
        ...(snap.exists ? {} : {createdAt: now}),
      },
      {merge: true}
    );
  });
  return {granted, skipped};
});

/**
 * Removes an admin-granted license (source === 'admin-grant' only -
 * purchase and group licenses keep their own revocation paths). The flat
 * licensedBookIds entry is only dropped when no remaining bookLicenses
 * entry still covers the book.
 */
export const revokeAdminGrantedLicense = onCall(async (request):
  Promise<RevokeAdminGrantedLicenseResult> => {
  await requireAdminRole(request.auth?.uid);

  const {email, bookId} =
    (request.data ?? {}) as Partial<RevokeAdminGrantedLicenseRequest>;
  if (!email || !bookId) {
    throw new HttpsError("invalid-argument", "email and bookId are required.");
  }
  const normalized = email.trim().toLowerCase();
  const ref = libraryDb.collection("libraryUsers").doc(normalized);
  let removed = false;
  await libraryDb.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) {
      throw new HttpsError(
        "not-found",
        "No library user record for that email."
      );
    }
    const data = snap.data() as {
      bookLicenses?: Record<string, unknown>[];
      licensedBookIds?: string[];
    };
    const allLicenses = Array.isArray(data.bookLicenses) ?
      data.bookLicenses :
      [];
    const bookLicenses = allLicenses.filter(
      (license) =>
        !(license["bookId"] === bookId && license["source"] === "admin-grant")
    );
    removed = bookLicenses.length !== allLicenses.length;
    if (!removed) {
      return;
    }
    const stillLicensed = bookLicenses.some(
      (license) => license["bookId"] === bookId
    );
    const priorIds = Array.isArray(data.licensedBookIds) ?
      data.licensedBookIds :
      [];
    const licensedBookIds = stillLicensed ?
      priorIds :
      priorIds.filter((id) => id !== bookId);
    transaction.update(ref, {
      bookLicenses,
      licensedBookIds,
      updatedAt: Date.now(),
    });
  });
  return {removed};
});

/**
 * Admin announcement to one, several, or all library users: one inbox doc
 * per recipient (libraryUsers/{email}/messages/{id} - the message of
 * record, written even for push-opted-out users) plus a device push per
 * recipient, plus one adminMessages summary doc backing the Message
 * History screen. Inbox doc ids are the summary id, so a retried send
 * overwrites instead of duplicating. recipients: 'all' expands to every
 * non-revoked user at send time, paged rather than one unbounded
 * collection read, filtering out revoked users in memory per page (a
 * where('revoked','!=',true) query would exclude docs missing the field
 * entirely); an explicit list MAY include a revoked user deliberately.
 * timeoutSeconds raised: the 'all' case does a token lookup + multicast
 * per recipient.
 */
export const sendLibraryUserMessage = onCall(
  {timeoutSeconds: 300},
  async (request):
  Promise<SendLibraryUserMessageResult> => {
    await requireAdminRole(request.auth?.uid);
    // requireAdminRole throws for a missing/invalid uid, so request.auth is
    // genuinely defined below -- this makes that explicit for TypeScript
    // too, rather than asserting it at each later usage site.
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }

    const {recipients, title, body} =
      (request.data ?? {}) as Partial<SendLibraryUserMessageRequest>;
    const trimmedTitle = (title ?? "").trim();
    const trimmedBody = (body ?? "").trim();
    if (!trimmedTitle || trimmedTitle.length > 120) {
      throw new HttpsError(
        "invalid-argument",
        "title is required (max 120 characters)."
      );
    }
    if (!trimmedBody || trimmedBody.length > 2000) {
      throw new HttpsError(
        "invalid-argument",
        "body is required (max 2000 characters)."
      );
    }
    const badRecipients =
      recipients !== "all" &&
      (!Array.isArray(recipients) || recipients.length === 0);
    if (badRecipients) {
      throw new HttpsError(
        "invalid-argument",
        "recipients must be 'all' or a non-empty email array."
      );
    }

    // This app's own admin_users, matched by firebaseUID - same lookup
    // requireAdminRole above already did, repeated here for the sender's
    // display name rather than threading it back out of that helper.
    const senderSnap = await getFirestore()
      .collection("admin_users")
      .where("firebaseUID", "==", request.auth.uid)
      .limit(1)
      .get();
    const sender = senderSnap.empty ?
      undefined :
      (senderSnap.docs[0].data() as {
          firstName?: string;
          lastName?: string;
          email?: string;
        });
    const sentByName =
      [sender?.firstName, sender?.lastName].filter(Boolean).join(" ") ||
      sender?.email ||
      "Library team";

    let emails: string[];
    let recipientScope: "all" | "selected";
    if (recipients === "all") {
      recipientScope = "all";
      // Paged rather than one unbounded libraryDb.collection('libraryUsers')
      // .get() - as the roster grows this keeps memory bounded to one page at a
      // time instead of holding every patron's full profile document in
      // memory at once. select('revoked') also trims each page's payload
      // to just the one field this loop actually needs (id is free - it's
      // the doc id).
      emails = [];
      const PAGE_SIZE = 500;
      let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
      for (;;) {
        let pageQuery = libraryDb
          .collection("libraryUsers")
          .select("revoked")
          .orderBy(FieldPath.documentId())
          .limit(PAGE_SIZE);
        if (cursor) {
          pageQuery = pageQuery.startAfter(cursor);
        }
        const page = await pageQuery.get();
        if (page.empty) {
          break;
        }
        for (const docSnap of page.docs) {
          if (docSnap.data().revoked !== true) {
            emails.push(docSnap.id);
          }
        }
        cursor = page.docs[page.docs.length - 1];
        if (page.docs.length < PAGE_SIZE) {
          break;
        }
      }
    } else {
      recipientScope = "selected";
      emails = Array.from(
        new Set(
          recipients.map((e) => String(e).trim().toLowerCase()).filter(Boolean)
        )
      );
      const snaps = await Promise.all(
        emails.map((e) => libraryDb.collection("libraryUsers").doc(e).get())
      );
      const unknown = emails.filter((_, i) => !snaps[i].exists);
      if (unknown.length > 0) {
        throw new HttpsError(
          "invalid-argument",
          `No library user record for: ${unknown.join(", ")}`
        );
      }
    }
    if (emails.length === 0) {
      throw new HttpsError("failed-precondition", "No recipients to send to.");
    }

    const now = Date.now();
    const summaryRef = libraryDb.collection(ADMIN_MESSAGES).doc();
    const messageId = summaryRef.id;

    const writer = libraryDb.bulkWriter();
    for (const recipientEmail of emails) {
      writer.set(
        libraryDb
          .collection("libraryUsers")
          .doc(recipientEmail)
          .collection("messages")
          .doc(messageId),
        {
          title: trimmedTitle,
          body: trimmedBody,
          sentAt: now,
          sentBy: request.auth.uid,
          sentByName,
          read: false,
          adminMessageId: messageId,
        }
      );
    }
    await writer.close();

    // Bounded-concurrency push fan-out; a per-recipient failure is logged
    // and skipped, never fatal - the inbox doc above already landed.
    let pushSuccessCount = 0;
    const CHUNK_SIZE = 20;
    for (let i = 0; i < emails.length; i += CHUNK_SIZE) {
      const results = await Promise.all(
        emails.slice(i, i + CHUNK_SIZE).map((recipientEmail) =>
          sendLibraryPushToUser(libraryDb, messaging, recipientEmail, {
            title: trimmedTitle,
            body: truncate(trimmedBody),
            route: "/messages",
            type: "admin-message",
            collapseKey: `admin-message-${messageId}`,
          }).catch(() => 0)
        )
      );
      pushSuccessCount += results.filter((successes) => successes > 0).length;
    }

    await summaryRef.set({
      title: trimmedTitle,
      body: trimmedBody,
      sentAt: now,
      sentBy: request.auth.uid,
      sentByName,
      recipientScope,
      ...(recipientScope === "selected" ? {recipients: emails} : {}),
      recipientCount: emails.length,
      pushSuccessCount,
    });
    return {messageId, recipientCount: emails.length, pushSuccessCount};
  }
);
