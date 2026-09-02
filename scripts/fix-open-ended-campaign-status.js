#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// Repairs the six long-running series that the Mailchimp regroup left
// marked ENDED (2026-08-22).
//
// apply-campaign-regroup.js (since archived) knew which groups were
// open-ended - it gave them `endDate: null` on purpose so future touches
// keep attaching - but wrote `status: "ended"` for EVERY group it created,
// unconditionally. effectiveStatus() short-circuits on the stored value
// before it ever looks at the dates, so these six read as ENDED forever.
//
// Not cosmetic: campaign-send.functions.ts skips tag-triggered touches
// whose campaign is not effectively 'live', silently and with no error.
//
// Flipping status to 'live' is enough - with endDate null, effectiveStatus()
// returns 'live' and stays there. The other 72 regrouped campaigns have real
// end dates and genuinely ended; they are not touched.
//
// Dry-run by default, like every script in this folder; pass --execute to
// write. Requires --project=<dev|prod>.
//
//   node scripts/fix-open-ended-campaign-status.js --project=dev
//   node scripts/fix-open-ended-campaign-status.js --project=dev --execute
//
// Idempotent: re-running on an already-live doc is a no-op.

const { getFirestoreFor, resolveProjectId } = require('./lib/firestore-admin');

// The OPEN_ENDED_KEYS of the regroup script, resolved to their doc ids.
const CAMPAIGN_IDS = [
  'grp_blog-posts',
  'grp_disciple-making-pastor-program',
  'grp_disciple-making-minute',
  'grp_monthly-newsletter',
  'grp_prayer-letter',
  'grp_podcast',
];

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

    // The whole premise is "open-ended series". If someone has since given
    // one a real end date, it is no longer that - leave it alone and say so.
    if (data.endDate != null) {
      console.log(`  SKIP     ${id.padEnd(36)} has an endDate now - not open-ended, left as-is`);
      continue;
    }
    if (data.status === 'live') {
      console.log(`  already  ${id.padEnd(36)} "${data.name}"`);
      continue;
    }

    console.log(`  LIVE     ${id.padEnd(36)} "${data.name}"  (was ${data.status})`);
    changed++;
    if (execute) {
      // A targeted field update, NOT a whole-doc write - nothing else on
      // these campaigns should move.
      await ref.update({ status: 'live' });
    }
  }

  console.log(
    changed === 0
      ? '\nNothing to do - all six already live.'
      : `\n${changed} campaign(s) ${execute ? 'set live.' : 'would be set live. Re-run with --execute to apply.'}`
  );
}

main().catch((err) => {
  console.error('fix-open-ended-campaign-status failed:', err);
  process.exit(1);
});
