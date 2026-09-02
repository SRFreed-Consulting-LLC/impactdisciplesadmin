#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// Stamps `source: 'web' | 'reader'` onto historic `purchases` documents
// (2026-08-21, bucket C item 1).
//
// The web storefront and the reader store both write into the SAME
// `purchases` collection with different shapes. Until now nothing recorded
// which was which, and the refund path inferred it from whether the doc
// carried a `paypalEnvironment` field - which decides WHICH PAYPAL APP the
// money is refunded through.
//
// New writes stamp `source` themselves. This backfills the existing rows so
// the inference fallback in functions/src/purchase-source.ts can eventually
// be removed. Until every environment has been backfilled, that fallback
// MUST stay - see its own comment.
//
// Classification, matching purchaseSourceOf() exactly:
//   - already has a valid `source`  -> left alone
//   - has a string paypalEnvironment -> reader
//   - otherwise                      -> web
//
// Note the one imprecision this inherits: a reader purchase that was free
// or coupon-only never carried paypalEnvironment, so it backfills as 'web'.
// That is harmless for refunds (the source is only consulted when a real
// PayPal charge exists), but it means `source` is a record of what the
// inference believed, not ground truth, for those rows. --strict-reader
// additionally treats a doc carrying `userId` as a reader purchase, which
// the reader store always writes and the web checkout never does; use it if
// you want those rows classified correctly.
//
// Dry-run by default like every script here; --execute to write.
//
//   node scripts/backfill-purchase-source.js --project=dev
//   node scripts/backfill-purchase-source.js --project=dev --execute
//
// Idempotent: re-running only touches docs that still lack `source`.

const { getFirestoreFor, resolveProjectId } = require('./lib/firestore-admin');

function classify(data, strictReader) {
  if (data.source === 'web' || data.source === 'reader') {
    return null; // already stamped
  }
  if (typeof data.paypalEnvironment === 'string') {
    return 'reader';
  }
  if (strictReader && typeof data.userId === 'string' && data.userId) {
    return 'reader';
  }
  return 'web';
}

async function main() {
  const args = process.argv.slice(2);
  const projectArg = (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];
  const execute = args.includes('--execute');
  const strictReader = args.includes('--strict-reader');

  const projectId = resolveProjectId(projectArg);
  const db = getFirestoreFor(projectId);

  console.log(
    `\nProject: ${projectId}${execute ? '  (EXECUTE)' : '  (dry run)'}` +
      `${strictReader ? '  [--strict-reader]' : ''}`
  );

  const snap = await tenantCollection(db, "purchases").get();
  const counts = { web: 0, reader: 0, skipped: 0 };
  let batch = db.batch();
  let pending = 0;

  for (const doc of snap.docs) {
    const source = classify(doc.data(), strictReader);
    if (!source) {
      counts.skipped++;
      continue;
    }
    counts[source]++;
    if (execute) {
      // A targeted field update, never a whole-doc write - these documents
      // hold two different shapes and nothing else here should move.
      batch.update(doc.ref, { source });
      pending++;
      if (pending === 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
  }

  if (execute && pending > 0) {
    await batch.commit();
  }

  console.log(`  total documents: ${snap.size}`);
  console.log(`  already stamped: ${counts.skipped}`);
  console.log(`  -> web:          ${counts.web}`);
  console.log(`  -> reader:       ${counts.reader}`);
  console.log(
    execute
      ? '\nBackfill complete.'
      : '\nDry run - re-run with --execute to apply.'
  );
}

main().catch((err) => {
  console.error('backfill-purchase-source failed:', err);
  process.exit(1);
});
