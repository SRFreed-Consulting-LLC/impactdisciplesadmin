#!/usr/bin/env node
// Deletes the imported Mailchimp STOCK templates from mail_templates
// (2026-08-21).
//
// These ten arrived with the Mailchimp migration and are not content: they
// are Mailchimp's own empty starter layouts with the placeholder copy still
// in them - "Sample copy. Lorem ipsum dolor sit amet...", "Getting started:
// Customize your template by clicking on the style editor tabs up above",
// bare "Heading 1 / Heading 2", and links pointing at mailchimp.com
// knowledge-base articles. Somebody typed a name on each ("DM Summit 2026
// (Mailchimp)") and never filled it in, so the names promise content the
// documents do not contain. Three of them are byte-identical to each other,
// as are another two - ten names over seven distinct bodies.
//
// They are also not real builder designs: the import wrapped each raw
// Mailchimp document in ONE opaque html block, so the drag-and-drop editor
// cannot meaningfully edit them, and none carries a subject line.
//
// Safe to remove: verified on 2026-08-21 that no Cloud Function, event
// (`emailTemplate`), or product (`followUpEmailId`) references any of them,
// and that 0 of 477 campaign_emails hold a templateId - a campaign email
// snapshots its content when it is created and never reads a template at
// send time. Deleting these cannot change any email that already exists.
//
// The campaign template gallery is better empty than full of lorem ipsum:
// it still offers the built-in starters (which ARE modelled on real sends -
// see starter-templates.ts), the Past Emails list, and fills up properly as
// staff use "Save as template".
//
// SAFETY: this refuses to delete anything that turns out to be referenced,
// or anything whose body does not actually look like Mailchimp boilerplate,
// however its name reads. Both are re-checked at run time rather than
// trusted from the audit above.
//
// Dry-run by default, like every script in this folder; pass --execute to
// write. Requires --project=<dev|prod>.
//
//   node scripts/delete-mailchimp-stock-templates.js --project=dev
//   node scripts/delete-mailchimp-stock-templates.js --project=dev --execute

const { getFirestoreFor, resolveProjectId } = require('./lib/firestore-admin');

// Names hard-coded in functions/src (grep-verified).
const FUNCTION_TEMPLATE_NAMES = new Set(['Sales Receipt', 'Amazon Shipping Confirmation']);

// Fingerprints of Mailchimp's own placeholder copy. A doc must match at
// least one to be considered stock, so a template someone has actually
// filled in is never removed just for carrying "(Mailchimp)" in its name.
const BOILERPLATE = [
  'lorem ipsum dolor sit amet',
  'getting started: customize your template',
  'click here to add your side column copy',
  'mailchimp.com/kb/article',
  'sample copy',
];

async function main() {
  const args = process.argv.slice(2);
  const projectArg = (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];
  const execute = args.includes('--execute');

  const projectId = resolveProjectId(projectArg);
  const db = getFirestoreFor(projectId);

  console.log(`\nProject: ${projectId}${execute ? '  (EXECUTE)' : '  (dry run)'}\n`);

  const [templates, events, products, campaignEmails] = await Promise.all([
    db.collection('mail_templates').get(),
    db.collection('events').get(),
    db.collection('products').get(),
    db.collection('campaign_emails').get(),
  ]);

  const eventTemplateNames = new Set();
  events.forEach((d) => {
    if (d.data().emailTemplate) eventTemplateNames.add(d.data().emailTemplate);
  });
  const productTemplateIds = new Set();
  products.forEach((d) => {
    if (d.data().followUpEmailId) productTemplateIds.add(d.data().followUpEmailId);
  });
  const pointerCount = campaignEmails.docs.filter((d) => d.data().templateId).length;

  console.log(`campaign_emails holding a templateId pointer: ${pointerCount}` +
    (pointerCount === 0 ? '  (none - content is snapshotted)' : '  <-- INVESTIGATE'));
  if (pointerCount > 0) {
    console.log('\nRefusing to run: some campaign email still points at a template doc.\n');
    process.exitCode = 1;
    return;
  }

  const doomed = [];
  const spared = [];

  for (const doc of templates.docs) {
    const t = doc.data();
    const name = t.name || '(unnamed)';
    if (!/mailchimp/i.test(name)) continue;

    const reasons = [];
    if (FUNCTION_TEMPLATE_NAMES.has(name)) reasons.push('referenced by a Cloud Function');
    if (eventTemplateNames.has(name)) reasons.push('referenced by an event');
    if (productTemplateIds.has(doc.id)) reasons.push('referenced by a product follow-up');

    const haystack = ((t.html || '') + ' ' + JSON.stringify(t.design || {})).toLowerCase();
    const matched = BOILERPLATE.filter((phrase) => haystack.includes(phrase));
    if (matched.length === 0) reasons.push('body does NOT look like Mailchimp boilerplate');

    if (reasons.length) {
      spared.push({ name, reasons });
    } else {
      doomed.push({ ref: doc.ref, id: doc.id, name, matched });
    }
  }

  console.log(`\nWould delete (${doomed.length}):`);
  doomed.forEach((d) => console.log(`  ${d.name.padEnd(38)} ${d.id}   [matched: ${d.matched[0]}]`));

  if (spared.length) {
    console.log(`\nSPARED (${spared.length}) - named "(Mailchimp)" but not safe/stock:`);
    spared.forEach((s) => console.log(`  ${s.name.padEnd(38)} ${s.reasons.join('; ')}`));
  }

  if (!execute) {
    console.log(`\nWould delete ${doomed.length} template(s). Re-run with --execute to write.\n`);
    return;
  }

  for (const d of doomed) {
    await d.ref.delete();
    console.log(`  DELETED  ${d.name}`);
  }
  console.log(`\nDeleted ${doomed.length} template(s). ${templates.size - doomed.length} remain.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
