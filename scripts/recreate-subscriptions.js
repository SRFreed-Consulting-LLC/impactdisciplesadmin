#!/usr/bin/env node
// Rebuilds the `subscriptions` collection (the newsletter + prayer team
// merge - see SubscriptionModel/subscription.model.ts and the
// "Combine Newsletter + Prayer Team subscriptions into one collection"
// commit) from a Prod snapshot's original, still-separate
// newsletter_subscriptions / prayer_team_subscriptions collections. Exists
// because `subscriptions` has no Prod equivalent to reimport directly - it
// only exists post-merge in Dev - so a Dev wipe-and-rebuild has to redo the
// merge from Prod's source collections instead of a plain import.
//
// Same merge logic as the original migration: each source doc gets a
// `type: "newsletter" | "prayer"` field added, doc IDs preserved, written
// into the target project's `subscriptions` collection.
//
// Dry-run by default. Pass --execute to actually write.
//
// Usage:
//   node scripts/recreate-subscriptions.js --snapshot=scripts/backups/impactdisciples-a82a8-<ts> --project=dev
//   node scripts/recreate-subscriptions.js --snapshot=... --project=dev --execute

const fs = require("fs");
const path = require("path");
const {resolveProjectId, getFirestoreFor, admin} = require("./lib/firestore-admin");
const {fromPortable} = require("./lib/firestore-json");

const SOURCES = [
  {file: "newsletter_subscriptions.json", type: "newsletter"},
  {file: "prayer_team_subscriptions.json", type: "prayer"},
];

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
  const execute = !!args.execute;
  const targetProjectId = resolveProjectId(args.project);

  if (!args.snapshot) {
    throw new Error("Missing --snapshot=<path-to-Prod-export.js-snapshot-dir>");
  }
  const snapshotDir = path.isAbsolute(args.snapshot) ?
    args.snapshot :
    path.join(process.cwd(), args.snapshot);

  const db = getFirestoreFor(targetProjectId);

  console.log(`${execute ? "LIVE RUN" : "DRY RUN"}: recreate-subscriptions`);
  console.log(`  Source snapshot: ${snapshotDir}`);
  console.log(`  Target project: ${targetProjectId}`);
  console.log("");

  let total = 0;
  const seenIds = new Set();
  let idCollisions = 0;

  for (const {file, type} of SOURCES) {
    const filePath = path.join(snapshotDir, file);
    if (!fs.existsSync(filePath)) {
      console.log(`  ${file}: NOT FOUND in snapshot, skipping`);
      continue;
    }
    const docs = JSON.parse(fs.readFileSync(filePath));

    let batch = db.batch();
    let opsInBatch = 0;

    for (const {id, data} of docs) {
      if (seenIds.has(id)) {
        idCollisions++;
      }
      seenIds.add(id);

      const restored = fromPortable(data, db, admin.firestore);
      const merged = {...restored, type};

      if (execute) {
        batch.set(db.collection("subscriptions").doc(id), merged);
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

    total += docs.length;
    console.log(`  ${file} -> subscriptions (type: "${type}"): ${docs.length} docs`);
  }

  console.log("");
  console.log(`Total: ${total} docs ${execute ? "written to" : "would be written to"} ${targetProjectId}'s subscriptions collection`);
  if (idCollisions > 0) {
    console.log(`WARNING: ${idCollisions} doc id(s) appeared in both source collections - later one won (last-write-wins).`);
  }
  if (!execute) {
    console.log("Dry run only - review the above, then re-run with --execute to write.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
