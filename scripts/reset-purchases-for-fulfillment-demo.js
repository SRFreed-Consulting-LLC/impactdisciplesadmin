#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// One-time-per-environment purchases cleanup, run after the fulfillment
// feature (onPurchaseFulfillmentEligible, functions/src/purchase-
// fulfillment.functions.ts) went live for the first time tonight. That
// trigger is onDocumentCreated-only, so no pre-existing purchase ever got
// a fulfillmentStatus stamped - the Fulfillment screen is empty right now
// regardless of processedStatus, in both dev and prod.
//
// - Purchases with dateProcessed older than 2 days: processedStatus set to
//   "COMPLETE" (payment/order status only - already-COMPLETE docs are
//   left alone, not touched).
// - Purchases within the last 2 days:
//   - already processedStatus === "COMPLETE": left untouched entirely.
//   - not complete AND has a physical item (same hasPhysicalItem() check
//     as the Cloud Function - some cart item that isn't an ebook/digital
//     book/event): fulfillmentStatus reset to "new", shippingLabel
//     cleared, so it appears fresh at the top of the Fulfillment workflow.
//   - not complete but no physical item (ebook/digital/event only): left
//     alone - correctly never eligible for the Fulfillment screen.
//
// Dry-run by default. Pass --execute to actually write. --project=dev|prod
// is required, no default (see lib/firestore-admin.js).
//
// Usage:
//   node scripts/reset-purchases-for-fulfillment-demo.js --project=dev
//   node scripts/reset-purchases-for-fulfillment-demo.js --project=dev --execute

const { firestore, resolveProjectId, getFirestoreFor } = require("./lib/firestore-admin");

function hasPhysicalItem(cartItems) {
  if (!Array.isArray(cartItems)) return false;
  return cartItems.some((item) => !item.isEBook && !item.isDigitalBook && !item.isEvent);
}

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
  const excludeIds = new Set(
    args.exclude ? String(args.exclude).split(",").map((s) => s.trim()) : []
  );
  const db = getFirestoreFor(projectId);

  const cutoffMs = Date.now() - 2 * 24 * 60 * 60 * 1000;

  const snap = await tenantCollection(db, "purchases").get();

  let oldToComplete = 0;
  let oldAlreadyComplete = 0;
  let recentAlreadyComplete = 0;
  let recentNoPhysical = 0;
  let recentAlreadyFresh = 0;
  let excludedCount = 0;
  const resetCandidates = [];

  let batch = db.batch();
  let ops = 0;
  const commitIfFull = async () => {
    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  };

  for (const doc of snap.docs) {
    const data = doc.data();
    const dp = data.dateProcessed;
    const dpMs = dp && typeof dp.toMillis === "function" ? dp.toMillis() : 0;
    const isRecent = dpMs >= cutoffMs;

    if (!isRecent) {
      if (data.processedStatus !== "COMPLETE") {
        oldToComplete++;
        if (execute) {
          batch.update(doc.ref, { processedStatus: "COMPLETE" });
          ops++;
          await commitIfFull();
        }
      } else {
        oldAlreadyComplete++;
      }
      continue;
    }

    // Recent (last 2 days)
    if (data.processedStatus === "COMPLETE") {
      recentAlreadyComplete++;
      continue;
    }
    if (!hasPhysicalItem(data.cartItems)) {
      recentNoPhysical++;
      continue;
    }
    if (data.fulfillmentStatus === "new" && !data.shippingLabel) {
      recentAlreadyFresh++;
      continue;
    }

    if (excludeIds.has(doc.id)) {
      excludedCount++;
      continue;
    }

    resetCandidates.push({
      id: doc.id,
      email: data.email,
      processedStatus: data.processedStatus,
      fulfillmentStatus: data.fulfillmentStatus ?? "(none)",
      hadShippingLabel: !!data.shippingLabel,
      dateProcessed: dpMs ? new Date(dpMs).toISOString() : "(no dateProcessed)",
    });
    if (execute) {
      batch.update(doc.ref, {
        fulfillmentStatus: "new",
        shippingLabel: firestore.FieldValue.delete(),
      });
      ops++;
      await commitIfFull();
    }
  }
  if (execute && ops > 0) {
    await batch.commit();
  }

  console.log(`${execute ? "LIVE RUN" : "DRY RUN"} against "${projectId}"`);
  console.log(`Cutoff: dateProcessed >= ${new Date(cutoffMs).toISOString()} counts as "recent" (last 2 days)\n`);

  console.log("OLD (older than 2 days):");
  console.log(`  ${oldToComplete} ${execute ? "marked" : "would be marked"} processedStatus=COMPLETE`);
  console.log(`  ${oldAlreadyComplete} already COMPLETE, left alone\n`);

  console.log("RECENT (last 2 days):");
  console.log(`  ${recentAlreadyComplete} already COMPLETE, left alone`);
  console.log(`  ${recentNoPhysical} not complete but no physical item (ebook/digital/event only), left alone`);
  console.log(`  ${recentAlreadyFresh} already fresh (fulfillmentStatus=new, no label), left alone`);
  console.log(`  ${excludedCount} excluded via --exclude, left alone`);
  console.log(`  ${resetCandidates.length} ${execute ? "reset" : "would be reset"} to fulfillmentStatus=new (shippingLabel cleared):`);
  resetCandidates.forEach((c) =>
    console.log(`    - ${c.id} | ${c.email} | processedStatus=${c.processedStatus} | fulfillmentStatus was ${c.fulfillmentStatus} | had label: ${c.hadShippingLabel} | ${c.dateProcessed}`)
  );

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
