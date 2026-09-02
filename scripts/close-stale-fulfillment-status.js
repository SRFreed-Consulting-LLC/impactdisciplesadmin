#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// Fixes a bug in migrate-processed-status-to-fulfillment.js's inference:
// it set fulfillmentStatus="shipping_label_printed" for any purchase with
// an existing shippingLabel, regardless of age - so old (already actually
// shipped, in real life) orders that happened to have a shippingLabel on
// record started showing up on the Dashboard/Fulfillment screens as if
// still in progress (fulfillmentStatus set + not "closed" is exactly what
// those screens filter on). This closes anything past the same 2-day
// cutoff used throughout tonight's purchases cleanup, regardless of its
// current fulfillmentStatus value (except docs already "closed", which are
// already correct and left untouched).
//
// Dry-run by default. Pass --execute to actually write. --project=dev|prod
// is required, no default (see lib/firestore-admin.js).
//
// Usage:
//   node scripts/close-stale-fulfillment-status.js --project=prod
//   node scripts/close-stale-fulfillment-status.js --project=prod --execute

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

  const cutoffMs = Date.now() - 2 * 24 * 60 * 60 * 1000;

  const snap = await tenantCollection(db, "purchases").where("fulfillmentStatus", "!=", "closed").get();

  const toClose = [];
  const statusCounts = {};

  for (const doc of snap.docs) {
    const data = doc.data();
    const dp = data.dateProcessed;
    const dpMs = dp && typeof dp.toMillis === "function" ? dp.toMillis() : 0;
    if (dpMs >= cutoffMs) continue; // still recent, leave alone

    toClose.push({ id: doc.id, ref: doc.ref, wasStatus: data.fulfillmentStatus, email: data.email });
    statusCounts[data.fulfillmentStatus] = (statusCounts[data.fulfillmentStatus] ?? 0) + 1;
  }

  console.log(`${execute ? "LIVE RUN" : "DRY RUN"} against "${projectId}"`);
  console.log(`Cutoff: dateProcessed < ${new Date(cutoffMs).toISOString()} counts as stale\n`);
  console.log(`${toClose.length} ${execute ? "closed" : "would be closed"} (fulfillmentStatus -> "closed"):`);
  console.log("  by previous status:", statusCounts);
  if (toClose.length <= 30) {
    toClose.forEach((c) => console.log(`    - ${c.id} | ${c.email} | was ${c.wasStatus}`));
  }

  if (execute && toClose.length > 0) {
    let batch = db.batch();
    let ops = 0;
    for (const c of toClose) {
      batch.update(c.ref, { fulfillmentStatus: "closed" });
      ops++;
      if (ops >= 400) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
    if (ops > 0) await batch.commit();
  }

  console.log("");
  if (!execute) {
    console.log("Dry run only - re-run with --execute to write.");
  } else {
    console.log("Done.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
