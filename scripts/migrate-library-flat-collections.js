#!/usr/bin/env node
// Phase 3 (consolidation plan) follow-up to migrate-library-content-to-
// nested.js: copies the remaining manager-owned, FLAT (no restructuring
// needed - no parent-id-reference fields to fold into a nesting path)
// collections out of the named 'impactdiscipleship-books' database into
// this project's own (default) database, under the SAME collection name.
// Straight copy, not a schema change.
//
// Scope, per explicit instruction: subtemplates, lessonTemplates,
// titleTranslations, commonTranslations, lessonImages, bulkDiscountTiers.
// Deliberately NOT `errorLogs`/`activityLog` (disposable history, not
// carried forward) and NOT any reader-app-owned collection (libraryUsers,
// discussionGroups, groupLicenses/Invites, submissions, lessonStatus/
// lessonHighlights/fcmTokens, adminMessages, purchases) - out of scope for
// this pass.
//
// None of these six collide with an existing top-level collection name in
// this project's own default database (checked before writing this - see
// migrate-library-content-to-nested.js's own comment on the `series`/
// `books`/`purchases` collisions that DID need handling elsewhere).
//
// Dry-run by default - reports counts without writing anything. Pass
// --execute to actually write. --project=dev|prod is required, no default.
// Safe to re-run: every write is a full setDoc keyed by the source doc's
// own id, so a re-run just overwrites with the same (or updated-at-source)
// content rather than duplicating anything.
//
// Usage:
//   node scripts/migrate-library-flat-collections.js --project=dev
//   node scripts/migrate-library-flat-collections.js --project=dev --execute

const {resolveProjectId, getFirestoreFor} = require("./lib/firestore-admin");

const NAMED_DB = "impactdiscipleship-books";
const CHUNK_SIZE = 400;
const COLLECTIONS = [
  "subtemplates",
  "lessonTemplates",
  "titleTranslations",
  "commonTranslations",
  "lessonImages",
  "bulkDiscountTiers",
];

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const eq = raw.indexOf("=");
    if (eq === -1) args[raw.slice(2)] = true;
    else args[raw.slice(2, eq)] = raw.slice(eq + 1);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const execute = !!args.execute;

  const sourceDb = getFirestoreFor(projectId, NAMED_DB);
  const targetDb = getFirestoreFor(projectId);

  console.log(`Project: ${projectId}`);
  console.log(`Mode: ${execute ? "EXECUTE (will write)" : "DRY RUN (no writes)"}`);
  console.log("");

  const writes = [];
  const counts = {};

  for (const name of COLLECTIONS) {
    const snap = await sourceDb.collection(name).get();
    counts[name] = snap.size;
    const targetRef = targetDb.collection(name);
    for (const doc of snap.docs) {
      writes.push({ref: targetRef.doc(doc.id), data: doc.data()});
    }
  }

  console.log("Source counts:");
  for (const name of COLLECTIONS) {
    console.log(`  ${name}: ${counts[name]}`);
  }
  console.log(`  TOTAL docs: ${writes.length}`);
  console.log("");

  if (!execute) {
    console.log("Dry run - nothing written. Re-run with --execute to write.");
    return;
  }

  for (let i = 0; i < writes.length; i += CHUNK_SIZE) {
    const chunk = writes.slice(i, i + CHUNK_SIZE);
    const batch = targetDb.batch();
    for (const {ref, data} of chunk) {
      batch.set(ref, data);
    }
    await batch.commit();
    console.log(`Wrote ${Math.min(i + CHUNK_SIZE, writes.length)}/${writes.length} docs...`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
