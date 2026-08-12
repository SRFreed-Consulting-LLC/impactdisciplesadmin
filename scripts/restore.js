#!/usr/bin/env node
// Restores a target project's Firestore collections to exactly match an
// export.js snapshot - the rollback half of the backup step in the Prod<->Dev
// plan. For every doc in the snapshot: full overwrite (not merge - this is a
// real restore, not an upsert) so any fields added after the snapshot was
// taken are wiped along with the rest. For every doc that exists in the
// target NOW but wasn't in the snapshot: deleted outright, since it didn't
// exist at snapshot time.
//
// Dry-run by default. Pass --execute to actually write/delete.
//
// Deliberately does NOT default to "every collection in the snapshot" - see
// --only below. A snapshot is a point-in-time capture of the WHOLE database;
// restoring all of it would undo any legitimate changes made after the
// snapshot for reasons unrelated to whatever you're actually rolling back
// (e.g. this repo's admin_users cleanup happened after the pre-import Dev
// snapshot was taken - a blind full restore would silently re-break that).
// Always pass --only naming exactly the collections you mean to roll back,
// unless you specifically want a full database restore.
//
// Usage:
//   node scripts/restore.js --snapshot=scripts/backups/impactdisciplesdev-<ts> --project=dev --only=purchases,events
//   node scripts/restore.js --snapshot=... --project=dev --only=purchases,events --execute

const fs = require("fs");
const path = require("path");
const {resolveProjectId, getFirestoreFor, admin} = require("./lib/firestore-admin");
const {fromPortable} = require("./lib/firestore-json");

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

/**
 * Resolves and sanity-checks a --snapshot=<path> argument.
 * @param {string} value Raw --snapshot value.
 * @return {string} Absolute path to a snapshot directory with a manifest.
 */
function resolveSnapshotDir(value) {
  if (!value) {
    throw new Error("Missing --snapshot=<path-to-export.js-snapshot-dir>");
  }
  const resolved = path.isAbsolute(value) ? value : path.join(process.cwd(), value);
  if (!fs.existsSync(path.join(resolved, "_manifest.json"))) {
    throw new Error(
      `No _manifest.json in ${resolved} - is this really an export.js snapshot dir?`
    );
  }
  return resolved;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshotDir = resolveSnapshotDir(args.snapshot);
  const targetProjectId = resolveProjectId(args.project);
  const execute = !!args.execute;

  const manifest = JSON.parse(
    fs.readFileSync(path.join(snapshotDir, "_manifest.json"))
  );
  const allCollections = Object.keys(manifest.collections);

  if (!args.only) {
    console.error(
      "Refusing to run without --only=<collections>. A snapshot captures the " +
      "WHOLE database - restoring every collection in it would also undo any " +
      "unrelated changes made since the snapshot. Pass --only naming exactly " +
      "what you mean to roll back, e.g. --only=" + allCollections.slice(0, 3).join(",") + ",..."
    );
    process.exit(1);
  }
  const only = new Set(String(args.only).split(",").map((s) => s.trim()));
  const collectionNames = allCollections.filter((c) => only.has(c));
  const unknownRequested = [...only].filter((c) => !allCollections.includes(c));

  console.log(`${execute ? "LIVE RUN" : "DRY RUN"}: restore`);
  console.log(`  Snapshot: ${snapshotDir}`);
  console.log(`    (project ${manifest.projectId}, exported ${manifest.exportedAt})`);
  console.log(`  Target project: ${targetProjectId}`);
  console.log(`  Restoring (${collectionNames.length}): ${collectionNames.join(", ")}`);
  if (unknownRequested.length) {
    console.log(`  NOTE: not in snapshot, ignored: ${unknownRequested.join(", ")}`);
  }
  console.log("");

  const db = getFirestoreFor(targetProjectId);
  const totals = {restore: 0, delete: 0};

  for (const name of collectionNames) {
    const snapshotDocs = JSON.parse(
      fs.readFileSync(path.join(snapshotDir, `${name}.json`))
    );
    const snapshotIds = new Set(snapshotDocs.map((d) => d.id));

    // Current docs, to find anything created after the snapshot was taken
    // (those get deleted, not just left alone).
    const currentRefs = await db.collection(name).listDocuments();
    const toDelete = currentRefs.filter((r) => !snapshotIds.has(r.id));

    let batch = db.batch();
    let opsInBatch = 0;

    for (const {id, data} of snapshotDocs) {
      const restored = fromPortable(data, db, admin.firestore);
      if (execute) {
        // Full overwrite, NOT merge - a real restore replaces the doc
        // entirely, including wiping any fields added after the snapshot.
        batch.set(db.collection(name).doc(id), restored);
        opsInBatch++;
        if (opsInBatch >= 400) {
          await batch.commit();
          batch = db.batch();
          opsInBatch = 0;
        }
      }
    }
    for (const ref of toDelete) {
      if (execute) {
        batch.delete(ref);
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

    totals.restore += snapshotDocs.length;
    totals.delete += toDelete.length;
    console.log(`  ${name}: ${snapshotDocs.length} to restore, ${toDelete.length} to delete`);
  }

  console.log("");
  console.log(`Totals: ${totals.restore} to restore, ${totals.delete} to delete`);
  console.log("");
  if (!execute) {
    console.log("Dry run only - review the above, then re-run with --execute to write.");
  } else {
    console.log(`Done - ${targetProjectId} restored to snapshot state for the collections above.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
