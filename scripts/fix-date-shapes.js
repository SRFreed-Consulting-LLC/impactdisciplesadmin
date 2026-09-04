#!/usr/bin/env node
// Standalone date-shape fix, independent of any import run - normalizes
// purchases.dateProcessed / events.startDate directly against a live
// project's own existing Firestore data (see lib/normalize-dates.js for
// which fields/collections and why). import.js also calls the same
// normalizer automatically while writing an imported snapshot; this script
// is for fixing docs that didn't come through an import at all (e.g.
// Dev's own organically-created bad data).
//
// Dry-run by default. Pass --execute to actually write.
//
// Usage:
//   node scripts/fix-date-shapes.js --project=dev
//   node scripts/fix-date-shapes.js --project=dev --execute

const {resolveProjectId, getFirestoreFor, firestore} = require("./lib/firestore-admin");
const {normalizeDoc, FIELDS_BY_COLLECTION} = require("./lib/normalize-dates");
const {tenantPath} = require("./lib/tenancy");

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
  const db = getFirestoreFor(projectId);

  console.log(`${execute ? "LIVE RUN" : "DRY RUN"} against "${projectId}"`);
  console.log("");

  let totalChanged = 0;
  const allWarnings = [];

  for (const collectionName of Object.keys(FIELDS_BY_COLLECTION)) {
    // THROUGH THE SEAM (fixed 2026-09-04). This read `db.collection(name)`
    // with a bare name, and every collection it targets moved under
    // `tenants/impactdisciples.com/` in the migration that finished on prod
    // 2026-09-02. From that day it scanned three collections holding zero
    // documents and printed "0/0 docs would be fixed" - which reads exactly
    // like a clean bill of health, and is the precise failure mode
    // scripts/lib/tenancy.js warns about in its own header.
    //
    // check-tenancy could not catch it: its scan looks for a quoted
    // collection name next to a `.collection(` call, and here the name
    // arrives in a variable while the literals live in normalize-dates.js
    // as object keys, nowhere near a Firestore call. The empty-collection
    // guard below is the belt to that missing brace - a collection that
    // ought to have documents and has none now says so loudly.
    const resolvedPath = tenantPath(collectionName);
    const snap = await db.collection(resolvedPath).get();
    if (snap.empty) {
      console.log(
        `  ${collectionName}: EMPTY at "${resolvedPath}" - not scanned. ` +
        "If that is a surprise, the path is wrong, not the data."
      );
      continue;
    }
    let changedCount = 0;
    let batch = db.batch();
    let opsInBatch = 0;

    for (const doc of snap.docs) {
      const {data, changed, warnings} = normalizeDoc(
        collectionName, doc.data(), firestore
      );
      allWarnings.push(...warnings);
      if (!changed) continue;
      changedCount++;

      if (execute) {
        batch.set(doc.ref, data, {merge: true});
        opsInBatch++;
        if (opsInBatch >= 400) {
          await batch.commit();
          batch = db.batch();
          opsInBatch = 0;
        }
      }
    }
    if (execute && opsInBatch > 0) {
      await batch.commit();
    }

    totalChanged += changedCount;
    console.log(
      `  ${collectionName}: ${changedCount}/${snap.size} docs ` +
      `${execute ? "fixed" : "would be fixed"}`
    );
  }

  if (allWarnings.length) {
    console.log(`\n${allWarnings.length} warning(s) (unparseable date strings, left as-is):`);
    allWarnings.slice(0, 20).forEach((w) => console.log(`  - ${w}`));
    if (allWarnings.length > 20) {
      console.log(`  ... and ${allWarnings.length - 20} more`);
    }
  }

  console.log("");
  console.log(`Total: ${totalChanged} doc(s) ${execute ? "fixed" : "would be fixed"}.`);
  if (!execute) {
    console.log("Dry run only - re-run with --execute to actually write.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
