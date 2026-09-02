#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// Clears every product's stored salePrice (Campaign Manager v3, 2026-08-22).
//
// Until now a product carried its own salePrice, typed into the Products form
// as a REQUIRED field, while an active global sale in `sales` overwrote it at
// read time anyway. Two sources of truth, one of which silently won.
//
// v3 makes campaigns the only source of a discount: the storefront prices a
// product from the campaign offers that actually target it, and salePrice
// becomes a computed display value. Whatever is stored today is therefore
// stale input, not data - the owner's decision was to DISCARD it rather than
// convert each non-zero value into a standing campaign.
//
// Sets salePrice to 0 rather than deleting the field: PricingService treats
// `salePrice > 0` as "on sale", so 0 reads as "no sale" everywhere already,
// and the Products grid keeps a number to render instead of a blank cell.
//
// DESTRUCTIVE AND NOT REVERSIBLE from inside this script - take a backup first:
//
//   npm run backup:prod
//   node scripts/clear-product-sale-prices.js --project=prod
//   node scripts/clear-product-sale-prices.js --project=prod --execute
//
// Dry-run by default, like every script in this folder. Idempotent: a product
// already at 0 is skipped, so re-running is a no-op.

const { getFirestoreFor, resolveProjectId } = require('./lib/firestore-admin');

async function main() {
  const args = process.argv.slice(2);
  const projectArg = (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];
  const execute = args.includes('--execute');

  const projectId = resolveProjectId(projectArg);
  const db = getFirestoreFor(projectId);

  console.log(`\nProject: ${projectId}${execute ? '  (EXECUTE)' : '  (dry run)'}`);

  const snap = await tenantCollection(db, "products").get();
  console.log(`  ${snap.size} product(s) in the collection\n`);

  let cleared = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const current = data.salePrice;

    // Absent, null, 0 or a non-number all already read as "no sale".
    if (typeof current !== 'number' || current === 0) {
      skipped++;
      continue;
    }

    const title = (data.title ?? '(untitled)').toString().slice(0, 40);
    console.log(`  CLEAR   ${doc.id.padEnd(22)} ${title.padEnd(42)} was $${current}`);
    cleared++;

    if (execute) {
      // A targeted field update, NOT a whole-doc write - nothing else on the
      // product should move.
      await doc.ref.update({ salePrice: 0 });
    }
  }

  console.log(
    `\n${skipped} already at zero.` +
      (cleared === 0
        ? ' Nothing to clear.'
        : ` ${cleared} ${execute ? 'cleared.' : 'would be cleared. Re-run with --execute to apply.'}`)
  );

  if (!execute && cleared > 0) {
    console.log('\nTake a backup first:  npm run backup:' + (projectId.includes('dev') ? 'dev' : 'prod'));
  }
}

main().catch((err) => {
  console.error('clear-product-sale-prices failed:', err);
  process.exit(1);
});
