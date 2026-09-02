#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
/**
 * Clear the Privacy Policy and Terms wording out of Web Config.
 *
 *   node scripts/web-config-drop-page-words.js --project=dev
 *   node scripts/web-config-drop-page-words.js --project=dev --execute
 *
 * Both are ORDINARY PAGES since 2026-08-31 - page_content/private-policy and
 * page_content/terms, with their own admin screens - and the fields were left
 * holding a second copy of the words on purpose, until somebody had read the
 * new pages. Shane said to go ahead.
 *
 * IT BACKS THE DOCUMENT UP FIRST, to scripts/backups/, and refuses to write
 * if that fails. These are 1,500 words of legal text and the copy on the
 * pages is about to be the only one; a git tag does not bring back a
 * Firestore field.
 *
 * IT REFUSES if either page is missing or empty. The whole reason the fields
 * were safe to clear is that the words are somewhere else - so that is
 * checked rather than assumed.
 *
 * WHAT IT DELIBERATELY LEAVES: equippingGroupTotalCost and
 * equippingGroupPaymentCost. They looked like two more dead fields - offered
 * in the price picker, named by no page - and they are not. The equipping
 * pages USED to render them:
 *
 *   <h6>Save with Full Payment: ${{webConfig.equippingGroupTotalCost}}</h6>
 *   <h6>4 Month Plan: ${{webConfig.equippingGroupPaymentCost}}/month</h6>
 *
 * and the four-page cutover dropped the lines. The prices (350 and 95) are
 * still correct and still in this document; what is missing is anything on
 * the pages that shows them. Deleting the fields would turn a page that has
 * lost its prices into a page that cannot get them back.
 *
 * DEV ONLY, dry-run by default, re-run is a no-op.
 */
const fs = require('fs');
const path = require('path');
const {getFirestoreFor, resolveProjectId} = require('./lib/firestore-admin');
const {firestore} = require('./lib/firestore-admin');
const {FieldValue} = firestore;

/** field on Web Config -> the page that carries those words now. */
const MOVED = {policy: 'private-policy', tos: 'terms'};

const args = process.argv.slice(2);
const execute = args.includes('--execute');
const projectArg = (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];

if (!projectArg) {
  console.error('Missing --project=dev. There is no default.');
  process.exit(1);
}
const projectId = resolveProjectId(projectArg);

if (/a82a8/.test(projectId) || projectArg === 'prod') {
  console.error('REFUSED: dev only.');
  process.exit(1);
}

/** Words in a page's text pieces, so "the page has the content" is checked
 *  rather than "the page exists". */
function wordsOn(page) {
  const blocks = page?.blocks ?? [];
  const html = blocks
    .flatMap((b) => b.columns ?? [])
    .flatMap((c) => c.pieces ?? [])
    .filter((p) => p.kind === 'text')
    .map((p) => p.html ?? '')
    .join(' ');
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().split(' ')
    .filter(Boolean).length;
}

(async () => {
  const db = getFirestoreFor(projectId);
  const doc = (await tenantCollection(db, "config").get()).docs[0];
  if (!doc) {
    console.error('REFUSED: no Web Config document.');
    process.exit(1);
  }
  const data = doc.data();

  const update = {};
  let refused = false;

  for (const [field, slug] of Object.entries(MOVED)) {
    const here = String(data[field] ?? '').trim();
    if (!here) {
      console.log(field + ': already empty.');
      continue;
    }

    const page = (await tenantCollection(db, "page_content").doc(slug).get()).data();
    const onPage = wordsOn(page);
    const inConfig = here.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      .split(' ').filter(Boolean).length;

    console.log('\n' + field + '  ->  page_content/' + slug);
    console.log('  in Web Config: ' + inConfig + ' words');
    console.log('  on the page  : ' + onPage + ' words');

    if (!onPage) {
      console.error('  REFUSED: the page has no text. The words here are the only copy.');
      refused = true;
      continue;
    }
    update[field] = FieldValue.delete();
  }

  if (refused) {
    console.error('\nNothing written - fix the page first.');
    process.exit(1);
  }
  if (!Object.keys(update).length) {
    console.log('\nNothing to do.');
    process.exit(0);
  }

  if (!execute) {
    console.log('\nDRY RUN. Re-run with --execute to write.');
    process.exit(0);
  }

  // A backup of the WHOLE document, not just the two fields - it costs
  // nothing and the next person will want the rest of it too.
  const dir = path.join(__dirname, 'backups');
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, 'web-config-before-page-words-drop.json');
  fs.writeFileSync(file, JSON.stringify({id: doc.id, data}, null, 2));
  console.log('\nBacked up to ' + file);

  await doc.ref.update(update);
  console.log('Written.');
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
