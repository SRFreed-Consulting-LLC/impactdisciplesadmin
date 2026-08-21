#!/usr/bin/env node
// One-time-per-environment migration completing the processedStatus ->
// fulfillmentStatus consolidation (see this repo's commit removing
// CheckoutForm.processedStatus and functions/src/purchase-fulfillment.
// functions.ts's updated onPurchaseFulfillmentEligible). Handles EXISTING
// purchase docs, which the trigger (onDocumentCreated-only) never touches:
//
// - Deletes the processedStatus field wherever present (CartItem-level
//   processedStatus, a different per-line-item field used for per-item
//   SHIPPED/REFUNDED tracking, is untouched).
// - Backfills fulfillmentStatus wherever it's missing, inferring the best
//   available value from what the doc already shows:
//     - has a shippingLabel already -> "shipping_label_printed" (known
//       real progress, don't understate it as "new" or overstate it as
//       done/"closed")
//     - has a physical line item, old processedStatus was NOT "COMPLETE"
//       -> "new" (still needs fulfillment)
//     - has a physical line item, old processedStatus WAS "COMPLETE", or
//       no physical item at all -> "closed" (nothing left to do)
//   Docs that already have a fulfillmentStatus (e.g. from tonight's PayPal
//   testing, or an earlier reset) are left alone - only the processedStatus
//   deletion applies to them, if they still carry that field.
//
// Dry-run by default. Pass --execute to actually write. --project=dev|prod
// is required, no default (see lib/firestore-admin.js).
//
// Usage:
//   node scripts/migrate-processed-status-to-fulfillment.js --project=dev
//   node scripts/migrate-processed-status-to-fulfillment.js --project=dev --execute

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

function inferFulfillmentStatus(data) {
  if (data.shippingLabel) return "shipping_label_printed";
  if (hasPhysicalItem(data.cartItems)) {
    return data.processedStatus === "COMPLETE" ? "closed" : "new";
  }
  return "closed";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const execute = !!args.execute;
  const db = getFirestoreFor(projectId);

  const snap = await db.collection("purchases").get();

  let processedStatusRemoved = 0;
  let fulfillmentBackfilled = 0;
  let alreadyClean = 0;
  const backfillBreakdown = { new: 0, closed: 0, shipping_label_printed: 0 };

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
    const updates = {};
    let changed = false;

    if ("processedStatus" in data) {
      updates.processedStatus = firestore.FieldValue.delete();
      processedStatusRemoved++;
      changed = true;
    }

    if (data.fulfillmentStatus === undefined) {
      const inferred = inferFulfillmentStatus(data);
      updates.fulfillmentStatus = inferred;
      backfillBreakdown[inferred]++;
      fulfillmentBackfilled++;
      changed = true;
    }

    if (!changed) {
      alreadyClean++;
      continue;
    }

    if (execute) {
      batch.update(doc.ref, updates);
      ops++;
      await commitIfFull();
    }
  }
  if (execute && ops > 0) {
    await batch.commit();
  }

  console.log(`${execute ? "LIVE RUN" : "DRY RUN"} against "${projectId}"`);
  console.log(`  ${snap.size} total purchases`);
  console.log(`  ${processedStatusRemoved} ${execute ? "had processedStatus removed" : "would have processedStatus removed"}`);
  console.log(`  ${fulfillmentBackfilled} ${execute ? "backfilled" : "would be backfilled"} with fulfillmentStatus:`);
  console.log(`    new: ${backfillBreakdown.new}, closed: ${backfillBreakdown.closed}, shipping_label_printed: ${backfillBreakdown.shipping_label_printed}`);
  console.log(`  ${alreadyClean} already clean (no processedStatus, already has fulfillmentStatus), left alone`);

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
