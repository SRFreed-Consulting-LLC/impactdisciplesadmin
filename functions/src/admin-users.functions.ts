import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

type AdminUserRole = "Admin" | "Employee";

/**
 * Throws unless `callerUid` has an admin_users record (matched by its
 * firebaseUID field - this collection isn't keyed by uid the way
 * impact-discipleship-library-manager-new's adminUsers is) with role
 * "Admin". Employees may view the Admin Users screen but not create/delete
 * accounts.
 * @param {string | undefined} callerUid Firebase Auth uid of the caller.
 * @return {Promise<void>} Resolves if the caller is an Admin, else throws.
 */
async function requireAdminRole(callerUid: string | undefined): Promise<void> {
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }

  const snap = await admin.firestore()
    .collection("admin_users")
    .where("firebaseUID", "==", callerUid)
    .limit(1)
    .get();

  if (snap.empty || snap.docs[0].data()?.role !== "Admin") {
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
export const createAdminUser = onCall(async (request) => {
  await requireAdminRole(request.auth?.uid);

  const data = (request.data ?? {}) as {
    email?: string;
    firstName?: string;
    lastName?: string;
    role?: AdminUserRole;
    phone?: unknown;
    shippingAddress?: unknown;
    billingAddress?: unknown;
  };
  const {email, firstName, lastName, role} = data;

  if (!email || !firstName || !lastName || !role) {
    throw new HttpsError(
      "invalid-argument",
      "email, firstName, lastName, and role are required."
    );
  }
  if (role !== "Admin" && role !== "Employee") {
    throw new HttpsError(
      "invalid-argument",
      "role must be \"Admin\" or \"Employee\"."
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

  const docRef = await admin.firestore().collection("admin_users").add({
    email,
    firstName,
    lastName,
    role,
    phone: data.phone ?? null,
    shippingAddress: data.shippingAddress ?? null,
    billingAddress: data.billingAddress ?? null,
    firebaseUID: userRecord.uid,
  });

  return {uid: userRecord.uid, docId: docRef.id};
});

/**
 * Deletes both the admin_users Firestore profile and the underlying
 * Firebase Auth account, keeping the two in sync. Caller must be an Admin
 * and cannot delete their own account.
 */
export const deleteAdminUser = onCall(async (request) => {
  await requireAdminRole(request.auth?.uid);

  const {docId} = (request.data ?? {}) as {docId?: string};
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
