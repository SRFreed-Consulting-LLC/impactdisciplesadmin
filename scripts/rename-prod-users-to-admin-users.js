#!/usr/bin/env node
// One-time, prod-only: copies prod's legacy `users` collection docs into
// prod's `admin_users` collection verbatim (same doc id, same fields,
// untouched) - completing the users -> admin_users rename in Prod that Dev
// already went through. Deliberately does NOT touch Dev and does NOT copy
// Dev's admin_users docs - Dev's firebaseUID values point at Dev's own
// Firebase Auth pool, not Prod's (confirmed by inspection: same person, two
// different firebaseUID values across environments). Prod's own `users`
// docs already carry the correct Prod firebaseUID, so this is a straight
// same-project copy, not a cross-environment promote.
//
// Old `users` collection is left in place afterward (orphaned, matching
// Dev's own precedent - see CLAUDE.md) - not deleted by this script.
//
// Usage:
//   node scripts/rename-prod-users-to-admin-users.js            # dry run
//   node scripts/rename-prod-users-to-admin-users.js --execute  # write

const { getFirestoreFor } = require("./lib/firestore-admin");

async function main() {
  const execute = process.argv.includes("--execute");
  const prodDb = getFirestoreFor("impactdisciples-a82a8");

  const usersSnap = await prodDb.collection("users").get();
  const existingAdminSnap = await prodDb.collection("admin_users").get();
  const existingIds = new Set(existingAdminSnap.docs.map((d) => d.id));

  console.log(`${execute ? "LIVE RUN" : "DRY RUN"}: prod users -> prod admin_users`);
  console.log(`  ${usersSnap.size} doc(s) in users, ${existingAdminSnap.size} already in admin_users\n`);

  let batch = prodDb.batch();
  let ops = 0;
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const collision = existingIds.has(doc.id);
    console.log(`  ${doc.id}  ${data.email}  (${data.role})${collision ? "  -- ALREADY EXISTS in admin_users, will overwrite" : ""}`);
    if (execute) {
      batch.set(prodDb.collection("admin_users").doc(doc.id), data);
      ops++;
    }
  }

  if (execute && ops > 0) {
    await batch.commit();
    console.log(`\nDone - ${ops} doc(s) written to prod admin_users. users collection left in place, untouched.`);
  } else if (!execute) {
    console.log("\nDry run only - re-run with --execute to write.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
