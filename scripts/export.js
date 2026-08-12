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
async function exportCollection(db, collectionName, outDir) {
  const snap = await db.collection(collectionName).get();
  const docs = snap.docs.map((d) => ({id: d.id, data: toPortable(d.data())}));
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
