#!/usr/bin/env node
// Deletes the retired `sales` collection (Campaign Manager v3, 2026-08-22).
//
// Sales are gone: a discount now comes from a campaign offer that names a
// product, a series, or an event, and free shipping is an offer flag. The
// admin screen, both services, the shared model and every reader have been
// removed, and the security rule is now deny-all - so these documents are
// already unreachable. This just stops them lingering.
//
// Verified before writing this: 2 documents in each project, 0 of them active.
// The one live behaviour the collection still had - a percentage off shipping -
// is replaced by campaign free shipping.
//
// Prints what each document was before deleting it, so the dry run doubles as
// the record of what was thrown away.
//
//   node scripts/delete-retired-sales.js --project=dev
//   node scripts/delete-retired-sales.js --project=dev --execute
//
// Dry-run by default. Idempotent: an empty collection is a no-op.

const { getFirestoreFor, resolveProjectId } = require('./lib/firestore-admin');

async function main() {
  const args = process.argv.slice(2);
  const projectArg = (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];
  const execute = args.includes('--execute');

  const projectId = resolveProjectId(projectArg);
  const db = getFirestoreFor(projectId);

  console.log(`\nProject: ${projectId}${execute ? '  (EXECUTE)' : '  (dry run)'}`);

  const snap = await db.collection('sales').get();

  if (snap.empty) {
    console.log('  sales is already empty - nothing to do.');
    return;
  }

  // Refuse to delete anything still switched on. Nothing should be by now, but
  // an active sale would mean someone is relying on a system this removes.
  const active = snap.docs.filter((doc) => doc.data().isActive === true);
  if (active.length > 0) {
    console.log(`\n  REFUSING: ${active.length} sale(s) are still active:`);
    active.forEach((doc) => console.log(`    ${doc.id}  "${doc.data().name}"`));
    console.log('\n  Turn them off, or rebuild them as campaign offers, first.');
    process.exitCode = 1;
    return;
  }

  for (const doc of snap.docs) {
    const data = doc.data();
    const parts = [
      data.isProducts ? 'products' : null,
      data.isEvents ? 'events' : null,
      data.isShipping ? 'shipping' : null
    ].filter(Boolean);

    console.log(
      `  DELETE  ${doc.id.padEnd(22)} "${data.name ?? '(unnamed)'}"  ` +
        `${data.percentOff ?? 0}% off ${parts.join('+') || 'nothing'}`
    );
    if (execute) {
      await doc.ref.delete();
    }
  }

  console.log(
    `\n${snap.size} sale(s) ${execute ? 'deleted.' : 'would be deleted. Re-run with --execute to apply.'}`
  );
}

main().catch((err) => {
  console.error('delete-retired-sales failed:', err);
  process.exit(1);
});
