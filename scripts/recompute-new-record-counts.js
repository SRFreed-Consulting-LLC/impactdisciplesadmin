#!/usr/bin/env node
// Fixes drift in meta/newRecordCounts, the aggregate doc backing the top-bar
// bell (functions/src/new-record-alerts.functions.ts). That doc is kept in
// sync incrementally (+1 on create, -1 on a newRecordStatus "new" -> other
// update) - deleting a doc that's still tagged "new" skips the decrement
// entirely (no onUpdate fires for a delete), permanently overcounting that
// source forever after. Live-diagnosed 2026-08-13: deleting a test purchase
// that still had newRecordStatus="new" left meta/newRecordCounts.purchases
// stuck at 1 with zero actual "new" purchases left, so the bell showed a
// permanently-stuck "1 new" badge that clicking could never clear (nothing
// left to mark seen).
//
// This recomputes each source's count directly from its own collection
// (a real where(newRecordStatus == 'new') count) and corrects
// meta/newRecordCounts to match reality - a full reconciliation, not an
// incremental patch, so it self-heals regardless of how the drift happened.
//
// Dry-run by default. Pass --execute to actually write. --project=dev|prod
// is required, no default (see lib/firestore-admin.js).
//
// Usage:
//   node scripts/recompute-new-record-counts.js --project=prod
//   node scripts/recompute-new-record-counts.js --project=prod --execute

const { resolveProjectId, getFirestoreFor } = require("./lib/firestore-admin");

const SOURCES = [
  { collection: "purchases", countField: "purchases" },
  { collection: "form_submissions", countField: "formSubmissions" },
  { collection: "event-registrations", countField: "eventRegistrations" },
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
  const db = getFirestoreFor(projectId);

  const metaRef = db.doc("meta/newRecordCounts");
  const metaSnap = await metaRef.get();
  const current = metaSnap.data() ?? {};

  console.log(`${execute ? "LIVE RUN" : "DRY RUN"} against "${projectId}"`);
  console.log("");

  const corrected = {};
  let anyDrift = false;

  for (const source of SOURCES) {
    const countSnap = await db.collection(source.collection).where("newRecordStatus", "==", "new").count().get();
    const real = countSnap.data().count;
    const stored = current[source.countField] ?? 0;
    corrected[source.countField] = real;

    if (real !== stored) {
      anyDrift = true;
      console.log(`  ${source.countField}: stored=${stored}, real=${real} - DRIFTED`);
    } else {
      console.log(`  ${source.countField}: stored=${stored}, real=${real} - OK`);
    }
  }

  console.log("");
  if (!anyDrift) {
    console.log("No drift found - meta/newRecordCounts already matches reality.");
    return;
  }

  if (execute) {
    await metaRef.set(corrected, { merge: true });
    console.log("Corrected meta/newRecordCounts to match reality.");
  } else {
    console.log("Dry run only - re-run with --execute to write the corrected counts.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
