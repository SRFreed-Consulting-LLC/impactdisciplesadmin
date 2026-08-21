import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import {
  CreateAdminUserRequest,
  CreateAdminUserResult,
  DeleteAdminUserRequest,
  DeleteAdminUserResult,
} from "./common/shared/contract/admin-callables.types";

/**
 * Throws unless `callerUid` has an admin_users record (matched by its
 * firebaseUID field - this collection isn't keyed by uid the way
 * impact-discipleship-library-manager-new's adminUsers is) with role
 * "Admin" (or "Root" - a single, manually-assigned super-admin account
 * with every permission Admin has, same as the client-side hasRole()
 * helper's own Root-inherits-Admin fallthrough in roles.enum.ts. This
 * check used to require the literal string "Admin", which silently locked
 * the Root account out of createAdminUser/deleteAdminUser - live-diagnosed
 * via a 403 while verifying the new permission system). Employees may view
 * the Admin Users screen but not create/delete accounts.
 * @param {string | undefined} callerUid Firebase Auth uid of the caller.
 * @return {Promise<void>} Resolves if the caller is an Admin or Root, else
 * throws.
 */
export async function requireAdminRole(
  callerUid: string | undefined
): Promise<void> {
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }

  const snap = await admin.firestore()
    .collection("admin_users")
    .where("firebaseUID", "==", callerUid)
    .limit(1)
    .get();

  const role = snap.empty ? undefined : snap.docs[0].data()?.role;
  if (role !== "Admin" && role !== "Root") {
    throw new HttpsError("permission-denied", "Admin role required.");
  }
}

/**
 * Creates a real Firebase Auth account for `email` and its matching
 * admin_users Firestore profile, keeping the two in sync. Caller must
 * already be an Admin. The new account has no password set here - the
 * client follows up with a password-reset email so the person can set
 * their own (see AdminUserService.createAdminUser).
 *
 * phone/shippingAddress/billingAddress are optional and written as-is if
 * present - AdminUserDialogComponent's Add form still shows those fields,
 * and this app's own update() does a full setDoc (no merge), so writing
 * everything here in the one create call avoids a follow-up write that
 * would otherwise have to carefully not clobber firebaseUID/role/etc.
 */
export const createAdminUser = onCall(async (request):
  Promise<CreateAdminUserResult> => {
  await requireAdminRole(request.auth?.uid);

  const data = (request.data ?? {}) as Partial<CreateAdminUserRequest>;
  const {email, firstName, lastName, role} = data;

  if (!email || !firstName || !lastName || !role) {
    throw new HttpsError(
      "invalid-argument",
      "email, firstName, lastName, and role are required."
    );
  }
  if (role !== "Admin" && role !== "Employee" && role !== "Editor") {
    throw new HttpsError(
      "invalid-argument",
      "role must be \"Admin\", \"Employee\", or \"Editor\"."
    );
  }

  const userRecord = await admin.auth().createUser({email}).catch((err) => {
    // Uncaught errors are masked as a generic "internal" error by the
    // callable framework before reaching the client, so the specific,
    // useful ones need to be translated into HttpsErrors explicitly here.
    const code = (err as {code?: string}).code;
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

  // If this write fails after the Auth account above already succeeded,
  // roll the Auth account back rather than leaving an orphan with no
  // admin_users profile - best-effort, same auth/user-not-found-swallowing
  // style deleteAdminUser already uses below.
  let docRef;
  try {
    docRef = await admin.firestore().collection("admin_users").add({
      email,
      firstName,
      lastName,
      role,
      phone: data.phone ?? null,
      shippingAddress: data.shippingAddress ?? null,
      billingAddress: data.billingAddress ?? null,
      firebaseUID: userRecord.uid,
    });
  } catch (err) {
    try {
      await admin.auth().deleteUser(userRecord.uid);
    } catch (cleanupErr) {
      // Best-effort - the profile-write failure below is the error that
      // actually reaches the caller either way, so just log this one.
      logger.error("Failed to roll back orphaned Auth account", cleanupErr);
    }
    throw new HttpsError(
      "internal",
      "Account created but the profile record failed to save."
    );
  }

  return {uid: userRecord.uid, docId: docRef.id};
});

/**
 * Deletes both the admin_users Firestore profile and the underlying
 * Firebase Auth account, keeping the two in sync. Caller must be an Admin
 * and cannot delete their own account.
 */
export const deleteAdminUser = onCall(async (request):
  Promise<DeleteAdminUserResult> => {
  await requireAdminRole(request.auth?.uid);

  const {docId} = (request.data ?? {}) as Partial<DeleteAdminUserRequest>;
  if (!docId) {
    throw new HttpsError("invalid-argument", "docId is required.");
  }

  const docRef = admin.firestore().collection("admin_users").doc(docId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Admin User not found.");
  }

  const firebaseUID: string | undefined =
    snap.data()?.firebaseUID;
  const callerUid = request.auth?.uid;
  if (firebaseUID && firebaseUID === callerUid) {
    throw new HttpsError(
      "failed-precondition",
      "You can't delete your own account."
    );
  }

  await docRef.delete();

  if (firebaseUID) {
    try {
      await admin.auth().deleteUser(firebaseUID);
    } catch (err) {
      const code = (err as {code?: string}).code;
      if (code !== "auth/user-not-found") {
        throw err;
      }
    }
  }

  return {docId};
});
