#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// One-time classification of every existing mail_templates doc into
// kind: 'system' | 'campaign' (2026-08-21).
//
// `mail_templates` now holds two lists told apart by `kind` - the SYSTEM
// templates the app sends from (receipts, event confirmations, product
// follow-ups, resolved by name or id inside Cloud Functions) and the
// CAMPAIGN templates the campaign email editor offers as starting points.
//
// THE RULE: a doc with a `design` blob is a campaign template; everything
// else is a system one.
//
// That looks arbitrary and is not a rule the app enforces going forward -
// the designer will happily save a system template with a design. It is a
// HISTORICAL fact about the data as it stands today, verified against both
// projects on 2026-08-21:
//
//   - every design-less (legacy Quill) template is a system one: 9 of them
//     in prod are still resolved by a Cloud Function, an event's
//     emailTemplate, or a product's followUpEmailId, and the other 3
//     (Consultation Survey Template, Lunch And Learn Template, Newsletter
//     Subscription Confirmation) are retired system templates whose senders
//     were replaced - marketing has never authored one in Quill;
//   - every design-bearing template is one of the 10 "(Mailchimp)" imports
//     brought in as marketing starting points, and NONE is referenced by
//     any function, event or product.
//
// Prod: 12 system / 10 campaign. Dev: 13 system / 10 campaign (dev also has
// the seeded Amazon Shipping Confirmation). Zero exceptions in either.
//
// Because the rule is historical, this is safe to run ONCE against today's
// data and is not a maintenance tool. It is idempotent - a doc that already
// carries any `kind` is skipped, so a re-run can never restamp a template
// an admin has since reclassified.
//
// Dry-run by default, like every script in this folder; pass --execute to
// write. Requires --project=<dev|prod>.
//
//   node scripts/backfill-template-kind.js --project=dev
//   node scripts/backfill-template-kind.js --project=dev --execute

const { getFirestoreFor, resolveProjectId } = require('./lib/firestore-admin');

async function main() {
  const args = process.argv.slice(2);
  const projectArg = (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];
  const execute = args.includes('--execute');

  const projectId = resolveProjectId(projectArg);
  const db = getFirestoreFor(projectId);

  console.log(`\nProject: ${projectId}${execute ? '  (EXECUTE)' : '  (dry run)'}\n`);

  const snap = await tenantCollection(db, "mail_templates").get();
  const planned = { system: [], campaign: [] };
  const skipped = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const name = data.name || '(unnamed)';

    if (data.kind) {
      skipped.push(`${name} (already '${data.kind}')`);
      continue;
    }
    planned[data.design ? 'campaign' : 'system'].push({ ref: doc.ref, name });
  }

  for (const kind of ['system', 'campaign']) {
    console.log(`  kind='${kind}'  (${planned[kind].length})`);
    planned[kind].forEach((r) => console.log(`      ${r.name}`));
    console.log('');
  }

  if (skipped.length) {
    console.log(`  skipped - already classified (${skipped.length})`);
    skipped.forEach((s) => console.log(`      ${s}`));
    console.log('');
  }

  const total = planned.system.length + planned.campaign.length;
  if (execute) {
    for (const kind of ['system', 'campaign']) {
      for (const row of planned[kind]) {
        await row.ref.update({ kind });
      }
    }
    console.log(`Stamped ${total} of ${snap.size} template(s).\n`);
  } else {
    console.log(`Would stamp ${total} of ${snap.size} template(s).`);
    if (total > 0) {
      console.log('Re-run with --execute to write.\n');
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
