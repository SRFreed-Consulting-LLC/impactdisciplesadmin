import {triggerPath} from "./common/shared/lists/tenancy";
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
/**
 * The nav groups whose screens hold BUSINESS RECORDS - contacts, orders,
 * registrations, campaigns and the reports over them.
 *
 * These are the groups on the ADMIN tab (nav-config.ts's NavSection); every
 * other group is `site` (page content) or `library`. The list is duplicated
 * here because functions/ cannot import src/app, and
 * functions/test/admin-claims-biz.test.js pins it against nav-config so the
 * copy cannot drift silently.
 */
const BUSINESS_GROUPS = [
  "contacts-manager",
  "events-manager",
  "store-manager",
  "tools-manager",
  "campaigns-manager",
  "reports-manager",
  "admin-manager",
];

/**
 * Has this staff member been given ANY business-records screen?
 *
 * The `biz` claim exists because a per-screen grant lives in an admin_users
 * document and rules can only read custom claims - so until now ANY Employee,
 * including one holding no grants at all, could read the entire customer
 * database straight from devtools. firestore.rules said exactly that in its
 * own header and accepted it (sweep S2, 2026-08-28).
 *
 * This does NOT mirror screen keys into the claim, which is the thing that
 * decision rejected as too intricate to keep honest. It mirrors ONE derived
 * fact - "was this person deliberately given some business access" - which
 * needs no collection-to-screen map inside the rules and cannot quietly come
 * to mean something subtler than it says.
 *
 * WHAT IT DOES NOT FIX, said plainly: an Employee granted ONE business screen
 * can still reach every business collection. Per-collection granularity needs
 * that map. This turns "any Employee, including one with none" into "an
 * Employee somebody deliberately gave business access to", which is most of
 * the blast radius for a fraction of the risk.
 * @param {string | undefined} role The staff role.
 * @param {unknown} permissions The admin_users permissions array.
 * @return {boolean} Whether business collections should open for them.
 */
export function hasBusinessAccess(
  role: string | undefined,
  permissions: unknown
): boolean {
  if (role === "Admin" || role === "Root") {
    return true;
  }
  if (role !== "Employee" || !Array.isArray(permissions)) {
    return false;
  }
  return permissions.some((grant) => {
    const key = (grant as {screenKey?: unknown})?.screenKey;
    return typeof key === "string" &&
      BUSINESS_GROUPS.some((g) => key === g || key.startsWith(g + "."));
  });
}

const VALID_ROLES = new Set([
  "Admin",
  "Root",
  "Employee",
  "Editor",
  "Customer",
]);

export const onAdminUserRoleSync = onDocumentWritten(
  triggerPath("admin_users", "{id}"),
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
    const beforeBiz = hasBusinessAccess(before?.role, before?.permissions);
    const afterBiz = hasBusinessAccess(after?.role, after?.permissions);

    if (before?.role === after?.role && beforeUid === afterUid &&
        beforeBiz === afterBiz) {
      // No role/link/access change - skip the Auth round trip (this trigger
      // fires on EVERY admin_users write, incl. lastLogin-style stamps).
      //
      // The biz comparison is why granting or revoking a business screen
      // reaches Auth at all: without it a permissions-only edit matched the
      // old early return and the claim never moved.
      return;
    }
    await setRoleClaim(afterUid, afterRole, afterBiz);
  }
);

/**
 * Sets (or clears, when role is undefined) the `role` custom claim,
 * preserving any other claims the account carries. Tolerates a deleted
 * Auth account - nothing to stamp, nothing to fail over.
 * @param {string} uid The Firebase Auth uid.
 * @param {string | undefined} role The role to stamp, or undefined.
 * @param {boolean} biz Whether business collections should open for them.
 * @return {Promise<void>} Resolves when the claim is synced.
 */
async function setRoleClaim(
  uid: string,
  role: string | undefined,
  biz = false
): Promise<void> {
  try {
    const user = await getAuth().getUser(uid);
    const claims = {...(user.customClaims ?? {})};
    if (role) {
      claims.role = role;
    } else {
      delete claims.role;
    }
    // Absent rather than false, so a token carries only what it grants and
    // `token.get('biz', false)` in rules reads the same either way.
    if (biz) {
      claims.biz = true;
    } else {
      delete claims.biz;
    }
    await getAuth().setCustomUserClaims(uid, claims);
    logger.info("Synced role claim",
      {uid, role: role ?? "(cleared)", biz});
  } catch (err) {
    if ((err as {code?: string}).code === "auth/user-not-found") {
      logger.warn("Role claim sync skipped - no Auth account", {uid});
      return;
    }
    throw err;
  }
}
