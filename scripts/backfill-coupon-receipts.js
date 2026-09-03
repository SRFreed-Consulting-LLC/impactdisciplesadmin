#!/usr/bin/env node
// One-off backfill (2026-09-03): a coupon-covered order's receipt IS its
// coupon code now, not the literal "COUPON" with the code beside it.
//
//   purchases        receipt "COUPON" -> receipt = the order's couponCode
//   affilliate_sales receipt "COUPON" -> receipt = the row's code
//
// The code written is the coupon's CANONICAL casing (looked up in `coupons`
// case-insensitively), because the receipt joins against coupons.code; the
// stored couponCode may carry whatever the shopper typed. A row whose code
// matches no coupon keeps the stored value as typed. A purchase with receipt
// "COUPON" and NO couponCode at all is reported and left alone - there is
// nothing to move.
//
// Dry run by default. Nothing else on the document is touched (update(),
// not set()).
//
//   node scripts/backfill-coupon-receipts.js --project=dev
//   node scripts/backfill-coupon-receipts.js --project=prod --execute
const {resolveProjectId, getFirestoreFor} = require("./lib/firestore-admin");
const {tenantPath} = require("./lib/tenancy");

async function main() {
  const args = process.argv.slice(2);
  const projectArg = (args.find((a) => a.startsWith("--project=")) || "")
    .split("=")[1];
  const projectId = resolveProjectId(projectArg);
  const execute = args.includes("--execute");
  const db = getFirestoreFor(projectId);

  console.log(`\nProject: ${projectId}${execute ? "  (EXECUTE)" : "  (dry run)"}`);

  // Canonical code by lower-cased code, from the coupons collection.
  const canonical = new Map();
  for (const doc of (await db.collection(tenantPath("coupons")).get()).docs) {
    const code = String(doc.data().code ?? "").trim();
    if (code && !canonical.has(code.toLowerCase())) {
      canonical.set(code.toLowerCase(), code);
    }
  }
  const toCanonical = (raw) => {
    const s = String(raw ?? "").trim();
    return s ? (canonical.get(s.toLowerCase()) ?? s) : "";
  };

  const plan = [];
  const skipped = [];

  const purchases = await db.collection(tenantPath("purchases"))
    .where("receipt", "==", "COUPON").get();
  for (const doc of purchases.docs) {
    const code = toCanonical(doc.data().couponCode);
    if (!code) {
      skipped.push(`purchases/${doc.id}: receipt COUPON but no couponCode`);
      continue;
    }
    plan.push({ref: doc.ref, label: `purchases/${doc.id}`, receipt: code});
  }

  const sales = await db.collection(tenantPath("affilliate_sales"))
    .where("receipt", "==", "COUPON").get();
  for (const doc of sales.docs) {
    const code = toCanonical(doc.data().code);
    if (!code) {
      skipped.push(`affilliate_sales/${doc.id}: receipt COUPON but no code`);
      continue;
    }
    plan.push({ref: doc.ref, label: `affilliate_sales/${doc.id}`, receipt: code});
  }

  console.log(`\n${purchases.size} purchases and ${sales.size} affiliate sales carry receipt "COUPON".`);
  for (const p of plan) console.log(`  ${p.label}  ->  receipt = "${p.receipt}"`);
  for (const s of skipped) console.log(`  SKIP ${s}`);

  if (!execute) {
    console.log(`\n${plan.length} would be updated, ${skipped.length} skipped. Re-run with --execute to apply.`);
    return;
  }

  // Firestore batches cap at 500 writes.
  let written = 0;
  for (let i = 0; i < plan.length; i += 400) {
    const batch = db.batch();
    for (const p of plan.slice(i, i + 400)) {
      batch.update(p.ref, {receipt: p.receipt});
      written += 1;
    }
    await batch.commit();
  }
  console.log(`\n${written} updated, ${skipped.length} skipped.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
