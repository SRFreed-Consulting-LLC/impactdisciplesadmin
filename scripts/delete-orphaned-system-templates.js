#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// Deletes SYSTEM templates nothing can reach any more (2026-08-21).
//
// Three templates outlived the code that sent them:
//
//   Consultation Survey Template  "You have Received a Consultation Survey request!"
//   Lunch And Learn Template      "You have Received a Lunch and Learn Survey request!"
//     Both were staff notifications fired when someone submitted the
//     matching form. Those per-type collections (consultation_surveys,
//     lunch_and_learns) were replaced by the generic Form Builder, and a
//     submission now writes one form_submissions doc whose only
//     notification is the in-app bell - see new-record-alerts.functions.ts.
//     Nothing has emailed anybody about a form submission since.
//
//   Newsletter Subscription Confirmation  "Thank you for subscribing"
//     Superseded by queueSubscriptionConfirmation() in
//     functions/src/transactional-emails.ts, which builds its own HTML
//     inline (including the free-ebook link and the unsubscribe footer)
//     and never reads this doc.
//
// Verified on 2026-08-21 against dev and prod: no event's emailTemplate,
// no product's followUpEmailId, and no document in ANY non-trivial
// collection mentions their name or id; and a grep across all three apps
// (admin, web, library reader) finds no code reference either.
//
// NOT included, though it has no database reference: Amazon Shipping
// Confirmation, which purchases.service.ts resolves BY NAME through
// AMAZON_CONFIRMATION_TEMPLATE_NAME. A data-only sweep would have called
// it orphaned - hence the allowlist below, and hence the run-time check
// that refuses any template a Cloud Function or the app names directly.
//
// Dry-run by default, like every script in this folder; pass --execute to
// write. Requires --project=<dev|prod>.
//
//   node scripts/delete-orphaned-system-templates.js --project=dev
//   node scripts/delete-orphaned-system-templates.js --project=dev --execute

const { getFirestoreFor, resolveProjectId } = require('./lib/firestore-admin');

// The exact templates this script is allowed to remove.
const TARGET_NAMES = new Set([
  'Consultation Survey Template',
  'Lunch And Learn Template',
  'Newsletter Subscription Confirmation',
]);

// Names resolved from code rather than data - never deletable by a sweep
// that only looks at Firestore. Grep-verified 2026-08-21.
const CODE_REFERENCED_NAMES = new Set([
  'Sales Receipt',                 // transactional-emails.ts
  'Amazon Shipping Confirmation',  // purchases.service.ts
]);

// Collections that cannot hold a template reference - skipped for cost.
const SKIP = new Set([
  'customers', 'purchases', 'mail', 'log-messages', 'errorLogs', 'activityLog',
  'affilliate_sales', 'tax_rates', 'tax_rate_summaries', 'notification_registrations',
  'commonTranslations', 'titleTranslations', 'campaign_sends', 'campaign_events',
  'tag_applications', 'libraryUsers', 'event-registrations', 'subscriptions',
]);

async function main() {
  const args = process.argv.slice(2);
  const projectArg = (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];
  const execute = args.includes('--execute');

  const projectId = resolveProjectId(projectArg);
  const db = getFirestoreFor(projectId);

  console.log(`\nProject: ${projectId}${execute ? '  (EXECUTE)' : '  (dry run)'}\n`);

  const candidates = (await tenantCollection(db, "mail_templates").get()).docs
    .filter((d) => TARGET_NAMES.has(d.data().name));

  if (candidates.length === 0) {
    console.log('Nothing to do - none of the target templates are present.\n');
    return;
  }

  // Re-verify reachability at run time rather than trusting the audit.
  const collections = (await db.listCollections()).filter((c) => !SKIP.has(c.id));
  const referencedBy = new Map();
  for (const col of collections) {
    if (col.id === 'mail_templates') continue;
    const snap = await col.get();
    for (const doc of snap.docs) {
      const json = JSON.stringify(doc.data());
      for (const c of candidates) {
        const name = c.data().name;
        if (json.includes(name) || json.includes(c.id)) {
          if (!referencedBy.has(c.id)) referencedBy.set(c.id, new Set());
          referencedBy.get(c.id).add(col.id);
        }
      }
    }
  }

  const doomed = [];
  const spared = [];
  for (const c of candidates) {
    const name = c.data().name;
    const reasons = [];
    if (CODE_REFERENCED_NAMES.has(name)) reasons.push('named directly in code');
    if (referencedBy.has(c.id)) reasons.push('referenced by ' + [...referencedBy.get(c.id)].join(', '));
    if (c.data().kind === 'campaign') reasons.push('is a campaign template, not a system one');
    if (reasons.length) spared.push({ name, reasons });
    else doomed.push({ ref: c.ref, id: c.id, name, subject: c.data().subject || '(none)' });
  }

  console.log(`Would delete (${doomed.length}):`);
  doomed.forEach((d) => console.log(`  ${d.name.padEnd(40)} ${d.id}\n      subject: "${d.subject}"`));

  if (spared.length) {
    console.log(`\nSPARED (${spared.length}):`);
    spared.forEach((s) => console.log(`  ${s.name.padEnd(40)} ${s.reasons.join('; ')}`));
  }

  if (!execute) {
    console.log(`\nWould delete ${doomed.length} template(s). Re-run with --execute to write.\n`);
    return;
  }

  for (const d of doomed) {
    await d.ref.delete();
    console.log(`  DELETED  ${d.name}`);
  }
  console.log(`\nDeleted ${doomed.length} template(s).\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
