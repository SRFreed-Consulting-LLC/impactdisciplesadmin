// One-time backfill: stamps the `role` custom claim onto every Firebase
// Auth account referenced by an admin_users doc's firebaseUID field -
// seeding the accounts that existed before the onAdminUserRoleSync
// trigger (functions/src/admin-claims.functions.ts) was deployed. Safe to
// re-run: setting the same claim twice is a no-op in effect.
//
// Usage (scripts/ conventions - DRY_RUN by default):
//   node scripts/backfill-admin-claims.js --project=dev
//   node scripts/backfill-admin-claims.js --project=dev --execute
"use strict";

const {
  admin,
  resolveProjectId,
  getFirestoreFor,
} = require("./lib/firestore-admin.js");

const VALID_ROLES = new Set([
  "Admin",
  "Root",
  "Employee",
  "Editor",
  "Customer",
]);

async function main() {
  const args = process.argv.slice(2);
  const projectArg = (args.find((a) => a.startsWith("--project=")) || "")
    .split("=")[1];
  const execute = args.includes("--execute");
  const projectId = resolveProjectId(projectArg);
  const db = getFirestoreFor(projectId);
  const auth = admin.app(`${projectId}::(default)`).auth();

  const snap = await db.collection("admin_users").get();
  console.log(
    `${execute ? "EXECUTE" : "DRY RUN"} - ${snap.size} admin_users docs ` +
    `in ${projectId}`
  );

  let stamped = 0;
  let skipped = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    const uid = typeof data.firebaseUID === "string" ? data.firebaseUID : "";
    const role = VALID_ROLES.has(data.role) ? data.role : undefined;
    const label = `${data.email || doc.id} -> role=${role} uid=${uid || "?"}`;
    if (!uid || !role) {
      console.log(`  SKIP (missing uid/role): ${label}`);
      skipped++;
      continue;
    }
    if (!execute) {
      console.log(`  would stamp: ${label}`);
      stamped++;
      continue;
    }
    try {
      const user = await auth.getUser(uid);
      const claims = {...(user.customClaims || {}), role};
      await auth.setCustomUserClaims(uid, claims);
      console.log(`  stamped: ${label}`);
      stamped++;
    } catch (err) {
      if (err.code === "auth/user-not-found") {
        console.log(`  SKIP (no Auth account): ${label}`);
        skipped++;
      } else {
        throw err;
      }
    }
  }
  console.log(`Done. ${stamped} stamped, ${skipped} skipped.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
