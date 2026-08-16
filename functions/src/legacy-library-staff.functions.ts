import {onCall, HttpsError} from "firebase-functions/v2/https";
import {getFirestore} from "firebase-admin/firestore";
import * as admin from "firebase-admin";

/**
 * Ported from impact-discipleship-library-manager-new's own staff-
 * provisioning Cloud Functions (functions/src/index.ts):
 * bootstrapFirstAdmin, createUser, linkExistingUser, deleteUser. These
 * manage the LEGACY, named-database `adminUsers` collection (uid-keyed) -
 * the manager app's OWN separate staff system, distinct from this app's
 * `admin_users` (see admin-users.functions.ts's createAdminUser/
 * deleteAdminUser, which already exist and are what this app's own Admin
 * Users screen actually calls).
 *
 * Ported verbatim, unchanged behavior, purely for completeness (moving
 * every function out of the standalone manager app's project per the
 * consolidation plan's Slice 6) - nothing in this app's own UI calls
 * these, and nothing should: an Editor account here is created via
 * admin-users.component.ts -> createAdminUser, not this file. Kept
 * functional rather than stripped down, in case anything still reads the
 * legacy `adminUsers` collection these write.
 */
const libraryDb = getFirestore(admin.app(), "impactdiscipleship-books");

// 'root' is a superset-of-admin tier, currently identical in behavior to
// 'admin' everywhere.
type LegacyAppUserRole = "admin" | "editor" | "root";
const ADMIN_EQUIVALENT_ROLES: readonly LegacyAppUserRole[] = ["admin", "root"];

/**
 * Throws unless `uid` has an existing legacy adminUsers/{uid} profile
 * with role "admin" or "root".
 * @param {string | undefined} uid Firebase Auth uid of the caller.
 * @return {Promise<void>} Resolves if authorized, else throws.
 */
async function requireLegacyAdmin(uid: string | undefined): Promise<void> {
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const snap = await libraryDb.collection("adminUsers").doc(uid).get();
  if (!snap.exists || !ADMIN_EQUIVALENT_ROLES.includes(snap.data()?.role)) {
    throw new HttpsError("permission-denied", "Admin role required.");
  }
}

/**
 * Throws unless assigning `targetRole` is allowed for the calling `uid` -
 * only an existing root user may hand out the root role itself. A no-op
 * for any non-root target role.
 * @param {string} uid Caller's Firebase Auth uid.
 * @param {LegacyAppUserRole} targetRole The role being assigned.
 * @return {Promise<void>} Resolves if allowed, else throws.
 */
async function requireRootToAssignRoot(
  uid: string,
  targetRole: LegacyAppUserRole
): Promise<void> {
  if (targetRole !== "root") {
    return;
  }
  const snap = await libraryDb.collection("adminUsers").doc(uid).get();
  if (snap.data()?.role !== "root") {
    throw new HttpsError(
      "permission-denied",
      "Only a root user can assign the root role."
    );
  }
}

/**
 * Throws unless removing/demoting `targetUid` is allowed for the calling
 * `callerUid` - only an existing root user may delete another root user.
 * A no-op when the target isn't currently root.
 * @param {string} callerUid Caller's Firebase Auth uid.
 * @param {string} targetUid The account being removed.
 * @return {Promise<void>} Resolves if allowed, else throws.
 */
async function requireRootToTouchRoot(
  callerUid: string,
  targetUid: string
): Promise<void> {
  const targetSnap = await libraryDb
    .collection("adminUsers")
    .doc(targetUid)
    .get();
  if (targetSnap.data()?.role !== "root") {
    return;
  }
  const callerSnap = await libraryDb
    .collection("adminUsers")
    .doc(callerUid)
    .get();
  if (callerSnap.data()?.role !== "root") {
    throw new HttpsError(
      "permission-denied",
      "Only a root user can remove another root user."
    );
  }
}

/**
 * Self-provisions the calling (already-authenticated) user as the first
 * admin. Only succeeds once, ever, while the legacy `adminUsers`
 * collection is completely empty.
 */
export const bootstrapFirstAdmin = onCall(async (request) => {
  const uid = request.auth?.uid;
  const email = request.auth?.token.email;
  if (!uid || !email) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }

  const displayName =
    (request.data?.displayName as string | undefined) || email;
  const now = Date.now();

  // Transactional so two concurrent first-logins right after a fresh
  // deploy can't both read "empty" before either write lands and both
  // become the first admin.
  await libraryDb.runTransaction(async (transaction) => {
    const existing = await transaction.get(
      libraryDb.collection("adminUsers").limit(1)
    );
    if (!existing.empty) {
      throw new HttpsError(
        "failed-precondition",
        "This project already has at least one user; bootstrap already " +
          "happened."
      );
    }
    transaction.set(libraryDb.collection("adminUsers").doc(uid), {
      uid,
      email,
      displayName,
      role: "admin" satisfies LegacyAppUserRole,
      createdAt: now,
      updatedAt: now,
      createdBy: uid,
      updatedBy: uid,
    });
  });

  return {uid};
});

/**
 * Creates a real Firebase Auth account for `email` and its matching
 * legacy adminUsers Firestore profile. Caller must already be a
 * legacy admin. The new account has no password set here.
 */
export const createUser = onCall(async (request) => {
  await requireLegacyAdmin(request.auth?.uid);

  const {email, displayName, role} = (request.data ?? {}) as {
    email?: string;
    displayName?: string;
    role?: LegacyAppUserRole;
  };
  if (!email || !role) {
    throw new HttpsError("invalid-argument", "email and role are required.");
  }
  if (role !== "admin" && role !== "editor" && role !== "root") {
    throw new HttpsError(
      "invalid-argument",
      "role must be \"admin\", \"editor\", or \"root\"."
    );
  }
  await requireRootToAssignRoot(request.auth!.uid, role);

  const userRecord = await admin
    .auth()
    .createUser({email})
    .catch((err) => {
      const code = (err as { code?: string }).code;
      if (code === "auth/email-already-exists") {
        throw new HttpsError(
          "already-exists",
          "An account with this email already exists."
        );
      }
      if (code === "auth/invalid-email") {
        throw new HttpsError(
          "invalid-argument",
          "That email address is not valid."
        );
      }
      throw err;
    });
  const now = Date.now();
  await libraryDb
    .collection("adminUsers")
    .doc(userRecord.uid)
    .set({
      uid: userRecord.uid,
      email,
      displayName: displayName || email,
      role,
      createdAt: now,
      updatedAt: now,
      createdBy: request.auth!.uid,
      updatedBy: request.auth!.uid,
    });

  return {uid: userRecord.uid};
});

/**
 * One-time migration utility: creates a legacy staff profile for an email
 * that already has a Firebase Auth account in this project (createUser
 * can't be used for this - it always calls auth.createUser and fails
 * with auth/email-already-exists). Caller must already be a legacy admin.
 */
export const linkExistingUser = onCall(async (request) => {
  await requireLegacyAdmin(request.auth?.uid);

  const {email, displayName, role} = (request.data ?? {}) as {
    email?: string;
    displayName?: string;
    role?: LegacyAppUserRole;
  };
  if (!email || !role) {
    throw new HttpsError("invalid-argument", "email and role are required.");
  }
  if (role !== "admin" && role !== "editor" && role !== "root") {
    throw new HttpsError(
      "invalid-argument",
      "role must be \"admin\", \"editor\", or \"root\"."
    );
  }
  await requireRootToAssignRoot(request.auth!.uid, role);

  const userRecord = await admin
    .auth()
    .getUserByEmail(email)
    .catch(() => {
      throw new HttpsError(
        "not-found",
        "No existing Firebase Auth account for that email."
      );
    });
  const now = Date.now();
  await libraryDb
    .collection("adminUsers")
    .doc(userRecord.uid)
    .set({
      uid: userRecord.uid,
      email,
      displayName: displayName || email,
      role,
      createdAt: now,
      updatedAt: now,
      createdBy: request.auth!.uid,
      updatedBy: request.auth!.uid,
    });

  return {uid: userRecord.uid};
});

/**
 * Deletes both the legacy Firestore profile and the underlying Firebase
 * Auth account, keeping the two in sync. Caller must be a legacy admin
 * and cannot delete themself.
 */
export const deleteUser = onCall(async (request) => {
  await requireLegacyAdmin(request.auth?.uid);

  const {uid} = (request.data ?? {}) as { uid?: string };
  if (!uid) {
    throw new HttpsError("invalid-argument", "uid is required.");
  }
  if (uid === request.auth!.uid) {
    throw new HttpsError(
      "failed-precondition",
      "You can't delete your own account."
    );
  }
  await requireRootToTouchRoot(request.auth!.uid, uid);

  await libraryDb.collection("adminUsers").doc(uid).delete();
  try {
    await admin.auth().deleteUser(uid);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "auth/user-not-found") {
      throw err;
    }
  }

  return {uid};
});
