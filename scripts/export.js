#!/usr/bin/env node
// Read-only Firestore -> JSON snapshot tool. Serves two roles in the Prod<->Dev
// data-promotion plan:
//   1. Backup: snapshot impactdisciplesdev before an import touches it, so
//      there's a rollback point.
//   2. Source: snapshot impactdisciples-a82a8 (Prod) to feed into import.js.
//
// Usage:
//   node scripts/export.js --project=dev
//   node scripts/export.js --project=prod --collections=purchases,events
//   node scripts/export.js --project=impactdisciplesdev --out=scripts/backups
//
// Safe by construction - this script never writes to Firestore, only reads.
// Every collection is written to its own JSON file under a timestamped
// snapshot directory (default: scripts/backups/<projectId>-<timestamp>/),
// plus a _manifest.json summarizing what was captured.

const fs = require("fs");
const path = require("path");
const {resolveProjectId, getFirestoreFor} = require("./lib/firestore-admin");
const {toPortable} = require("./lib/firestore-json");

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
 * Builds a filesystem-safe timestamp for the snapshot directory name.
 * @return {string} e.g. "2026-08-11T20-15-30Z".
 */
function timestampForDirName() {
  return new Date().toISOString().replace(/:/g, "-").replace(/\..+Z$/, "Z");
}

/**
 * Exports every doc in one collection to a JSON array file.
 * @param {import("firebase-admin").firestore.Firestore} db Source Firestore.
 * @param {string} collectionName Collection to export.
 * @param {string} outDir Directory to write <collectionName>.json into.
 * @return {Promise<number>} Number of docs exported.
 */
/**
 * Every document under a collection INCLUDING its descendants, each keyed by
 * its full path.
 *
 * THIS EXPORT WAS FLAT UNTIL 2026-09-02, and the gap was invisible because
 * the counts looked right: `libraryUsers` reported 96 documents and there
 * genuinely are 96 - it just also has 289 more beneath them. A patron's
 * lesson submissions, their highlights, their progress markers; a group's
 * members, chat and prayer requests; the whole books/units/lessons/
 * translations tree under `librarySeries`. None of it was in the file
 * anybody would reach for in an emergency.
 *
 * Keyed by PATH rather than by id, because an id alone no longer says where
 * a document belongs - `submissions/lesson-3` exists under every patron who
 * ever opened lesson 3. A backup that cannot be restored to the right place
 * is not a backup.
 *
 * listDocuments(), not get(): a query returns documents that have FIELDS, and
 * a parent with none but with children beneath it is invisible to one and
 * returned by the other. Firestore makes that shape whenever a parent is
 * deleted and its children are not - production had five such documents.
 *
 * @param {object} col A collection reference.
 * @param {Array<object>} out Accumulator.
 * @return {Promise<Array<object>>} out
 */
async function collectTree(col, out = []) {
  const refs = await col.listDocuments();
  const LANES = 40;
  for (let i = 0; i < refs.length; i += LANES) {
    const slice = refs.slice(i, i + LANES);
    const [snaps, subLists] = await Promise.all([
      Promise.all(slice.map((r) => r.get())),
      Promise.all(slice.map((r) => r.listCollections())),
    ]);
    for (let j = 0; j < slice.length; j++) {
      if (snaps[j].exists) {
        out.push({
          path: slice[j].path,
          id: slice[j].id,
          data: toPortable(snaps[j].data()),
        });
      }
      for (const sub of subLists[j]) await collectTree(sub, out);
    }
  }
  return out;
}

async function exportCollection(db, collectionName, outDir) {
  const docs = await collectTree(db.collection(collectionName));
  fs.writeFileSync(
    path.join(outDir, `${collectionName}.json`),
    JSON.stringify(docs, null, 2)
  );
  return docs.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const outRoot = args.out || path.join(__dirname, "backups");
  const outDir = path.join(outRoot, `${projectId}-${timestampForDirName()}`);
  fs.mkdirSync(outDir, {recursive: true});

  const db = getFirestoreFor(projectId);

  let collections;
  if (args.collections) {
    collections = String(args.collections).split(",").map((c) => c.trim());
  } else {
    const refs = await db.listCollections();
    collections = refs.map((r) => r.id).sort();
  }

  console.log(`Exporting project "${projectId}" -> ${outDir}`);
  console.log(`Collections (${collections.length}): ${collections.join(", ")}`);
  console.log("");

  const counts = {};
  for (const name of collections) {
    process.stdout.write(`  ${name} ... `);
    const count = await exportCollection(db, name, outDir);
    counts[name] = count;
    console.log(`${count} docs`);
  }

  fs.writeFileSync(
    path.join(outDir, "_manifest.json"),
    JSON.stringify(
      {
        projectId,
        exportedAt: new Date().toISOString(),
        totalDocs: Object.values(counts).reduce((a, b) => a + b, 0),
        collections: counts,
      },
      null,
      2
    )
  );

  console.log("");
  console.log(`Done. Snapshot written to: ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
