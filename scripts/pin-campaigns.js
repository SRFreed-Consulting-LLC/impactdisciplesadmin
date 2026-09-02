#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// Pins the two ongoing series staff open constantly - Monthly Newsletter and
// Prayer Letter - to the top of the Campaigns screen (2026-08-21).
//
// Sets `pinned: true` on two known campaign docs and nothing else. Every
// other campaign is deliberately left WITHOUT the field: see
// campaign.model.ts's `pinned` comment - the list is a cursor-paged query
// and the pinned strip is its own where('pinned','==',true) lookup, so
// absence is the normal state and there is nothing to backfill.
//
// Dry-run by default, like every script in this folder; pass --execute to
// write. Requires --project=<dev|prod>.
//
//   node scripts/pin-campaigns.js --project=dev
//   node scripts/pin-campaigns.js --project=dev --execute
//
// Idempotent: re-running on an already-pinned doc is a no-op.

const { getFirestoreFor, resolveProjectId } = require('./lib/firestore-admin');

const CAMPAIGN_IDS = ['grp_monthly-newsletter', 'grp_prayer-letter'];

async function main() {
  const args = process.argv.slice(2);
  const projectArg = (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];
  const execute = args.includes('--execute');

  const projectId = resolveProjectId(projectArg);
  const db = getFirestoreFor(projectId);

  console.log(`\nProject: ${projectId}${execute ? '  (EXECUTE)' : '  (dry run)'}`);

  let changed = 0;
  for (const id of CAMPAIGN_IDS) {
    const ref = tenantCollection(db, "campaigns").doc(id);
    const snap = await ref.get();

    if (!snap.exists) {
      console.log(`  MISSING  ${id} - no such campaign, skipping`);
      continue;
    }

    const data = snap.data();
    if (data.pinned === true) {
      console.log(`  already  ${id.padEnd(24)} "${data.name}"`);
      continue;
    }

    console.log(`  PIN      ${id.padEnd(24)} "${data.name}"`);
    changed++;
    if (execute) {
      // A targeted field update, NOT a whole-doc write - nothing else on
      // these campaigns should move.
      await ref.update({ pinned: true });
    }
  }

  console.log(
    changed === 0
      ? '\nNothing to do - both already pinned.'
      : `\n${changed} campaign(s) ${execute ? 'pinned.' : 'would be pinned. Re-run with --execute to apply.'}`
  );
}

main().catch((err) => {
  console.error('pin-campaigns failed:', err);
  process.exit(1);
});
