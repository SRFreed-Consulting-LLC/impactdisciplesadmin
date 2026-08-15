#!/usr/bin/env node
// One-time bulk activation for the `coaches` collection - the user wants
// every breakout-only coach live on the public web (a "Coaches" display
// sorted by `sortOrder`), so isActive needs to be true across the board
// rather than left at whatever it happened to be from admin-only usage
// (where an inactive coach just meant "hidden from the Coaches picker",
// not "not real"). See MIGRATION.md's "Coaches split into Coaches +
// Impact Team" section for the split this follows on from.
//
// Dry-run by default - reports counts without writing anything. Pass
// --execute to actually write. --project=dev|prod is required, no default
// (see lib/firestore-admin.js).
//
// Usage:
//   node scripts/activate-all-coaches.js --project=dev
//   node scripts/activate-all-coaches.js --project=dev --execute

const { resolveProjectId, getFirestoreFor } = require("./lib/firestore-admin");

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
  const db = getFirestoreFor(projectId);

  console.log(`${execute ? "LIVE RUN" : "DRY RUN"} against "${projectId}"\n`);

  const snap = await db.collection("coaches").get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const toActivate = all.filter((c) => c.isActive !== true);

  console.log(`${all.length} total coaches (${toActivate.length} not currently active -> would set isActive=true, ${all.length - toActivate.length} already active)\n`);

  toActivate.forEach((c) => {
    console.log(`  ${c.id}  ${c.firstName || ""} ${c.lastName || ""}  isActive=${c.isActive}  sortOrder=${c.sortOrder}`);
  });
  console.log("");

  if (toActivate.length === 0) {
    console.log("Nothing to do - every coach is already active.");
    return;
  }

  if (!execute) {
    console.log("Dry run only - re-run with --execute to write.");
    return;
  }

  let batch = db.batch();
  let opsInBatch = 0;
  let batchesFlushed = 0;

  for (const coach of toActivate) {
    batch.update(db.collection("coaches").doc(coach.id), { isActive: true });
    opsInBatch++;
    if (opsInBatch >= 400) {
      await batch.commit();
      batchesFlushed++;
      batch = db.batch();
      opsInBatch = 0;
    }
  }
  if (opsInBatch > 0) {
    await batch.commit();
    batchesFlushed++;
  }

  console.log(`Done - activated ${toActivate.length} record(s), ${batchesFlushed} batch(es) committed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
