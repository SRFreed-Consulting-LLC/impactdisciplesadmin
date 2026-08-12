#!/usr/bin/env node
// Deletes every document in every collection of a project, EXCEPT whatever
// is named in --except. Built for the "wipe Dev and rebuild from Prod"
// reset - always take a fresh export.js backup of the target project before
// running this with --execute, there's no undo built into this script
// itself.
//
// Dry-run by default. Pass --execute to actually delete.
//
// Usage:
//   node scripts/delete-collections.js --project=dev --except=admin_users,forms
//   node scripts/delete-collections.js --project=dev --except=admin_users,forms --execute

const {resolveProjectId, getFirestoreFor} = require("./lib/firestore-admin");

/**
 * Parses simple --key=value / --flag CLI arguments.
 * @param {string[]} argv process.argv.slice(2).
 * @return {Object<string,string|boolean>} Parsed args.
 */
function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const eq = raw.indexOf("=");
    if (eq === -1) {
      args[raw.slice(2)] = true;
    } else {
      args[raw.slice(2, eq)] = raw.slice(eq + 1);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const execute = !!args.execute;
  const except = new Set(
    args.except ? String(args.except).split(",").map((s) => s.trim()) : []
  );

  if (except.size === 0) {
    console.error(
      "Refusing to run without --except=<collections-to-keep>. Deleting " +
      "literally everything is almost never actually what you want - pass " +
      "an (even empty-feeling) explicit list, e.g. --except=admin_users,forms"
    );
    process.exit(1);
  }

  const db = getFirestoreFor(projectId);
  const allCollections = (await db.listCollections()).map((c) => c.id).sort();
  const toDelete = allCollections.filter((c) => !except.has(c));
  const kept = allCollections.filter((c) => except.has(c));

  console.log(`${execute ? "LIVE RUN" : "DRY RUN"}: delete-collections`);
  console.log(`  Project: ${projectId}`);
  console.log(`  Keeping (${kept.length}): ${kept.join(", ") || "(none)"}`);
  console.log(`  Deleting (${toDelete.length}): ${toDelete.join(", ")}`);
  console.log("");

  let totalDeleted = 0;
  for (const name of toDelete) {
    const refs = await db.collection(name).listDocuments();
    if (execute) {
      let batch = db.batch();
      let opsInBatch = 0;
      for (const ref of refs) {
        batch.delete(ref);
        opsInBatch++;
        if (opsInBatch >= 400) {
          await batch.commit();
          batch = db.batch();
          opsInBatch = 0;
        }
      }
      if (opsInBatch > 0) {
        await batch.commit();
      }
    }
    totalDeleted += refs.length;
    console.log(`  ${name}: ${refs.length} docs ${execute ? "deleted" : "to delete"}`);
  }

  console.log("");
  console.log(`Total: ${totalDeleted} docs ${execute ? "deleted" : "to delete"} across ${toDelete.length} collections`);
  if (!execute) {
    console.log("Dry run only - review the above, then re-run with --execute to delete.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
