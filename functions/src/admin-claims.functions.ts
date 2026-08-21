import {onDocumentWritten} from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import {getAuth} from "firebase-admin/auth";

/**
 * Phase 7 staff-identity foundation: mirrors admin_users role assignments
 * into Firebase Auth CUSTOM CLAIMS ({role: 'Admin'|'Root'|'Employee'|
 * 'Editor'|'Customer'}), so firestore.rules can check
 * `request.auth.token.role` directly. Rules cannot do it any other way:
 * admin_users docs are auto-id keyed with firebaseUID as a FIELD, and
 * rules can neither run queries nor look a doc up by a field value.
 *
 * A Firestore trigger (rather than baking claim-setting into
 * createAdminUser alone) so the claim tracks EVERY write path - the
 * Admin Users screen edits roles via direct client writes today, and any
 * future path stays covered automatically. Claim propagation: an already
 * signed-in user picks the new claim up on their next ID-token refresh
 * (up to ~1h) or immediately on next sign-in; the clients' own UI-level
 * role checks (PermissionService) remain the instant-feedback layer.
 *
 * scripts/backfill-admin-claims.js seeds claims for admin_users docs
 * that existed before this trigger deployed - run it once after the
 * first deploy.
 */
const VALID_ROLES = new Set([
  "Admin",
  "Root",
  "Employee",
  "Editor",
  "Customer",
]);

export const onAdminUserRoleSync = onDocumentWritten(
  "admin_users/{id}",
  async (event) => {
    const before = event.data?.before?.exists ?
      event.data.before.data() :
      undefined;
    const after = event.data?.after?.exists ?
      event.data.after.data() :
      undefined;

    const beforeUid =
      typeof before?.firebaseUID === "string" ? before.firebaseUID : "";
    const afterUid =
      typeof after?.firebaseUID === "string" ? after.firebaseUID : "";
    const afterRole =
      typeof after?.role === "string" && VALID_ROLES.has(after.role) ?
        after.role :
        undefined;

    // If the doc was deleted, or its firebaseUID changed, clear the OLD
    // account's claim first so a re-linked/removed staff member doesn't
    // keep privileges on a stale token forever.
    if (beforeUid && beforeUid !== afterUid) {
      await setRoleClaim(beforeUid, undefined);
    }
    if (!afterUid) {
      return;
    }
    if (before?.role === after?.role && beforeUid === afterUid) {
      // No role/link change - skip the Auth round trip (this trigger
      // fires on EVERY admin_users write, incl. lastLogin-style stamps).
      return;
    }
    await setRoleClaim(afterUid, afterRole);
  }
);

/**
 * Sets (or clears, when role is undefined) the `role` custom claim,
 * preserving any other claims the account carries. Tolerates a deleted
 * Auth account - nothing to stamp, nothing to fail over.
 * @param {string} uid The Firebase Auth uid.
 * @param {string | undefined} role The role to stamp, or undefined.
 * @return {Promise<void>} Resolves when the claim is synced.
 */
async function setRoleClaim(
  uid: string,
  role: string | undefined
): Promise<void> {
  try {
    const user = await getAuth().getUser(uid);
    const claims = {...(user.customClaims ?? {})};
    if (role) {
      claims.role = role;
    } else {
      delete claims.role;
    }
    await getAuth().setCustomUserClaims(uid, claims);
    logger.info("Synced role claim", {uid, role: role ?? "(cleared)"});
  } catch (err) {
    if ((err as {code?: string}).code === "auth/user-not-found") {
      logger.warn("Role claim sync skipped - no Auth account", {uid});
      return;
    }
    throw err;
  }
}
