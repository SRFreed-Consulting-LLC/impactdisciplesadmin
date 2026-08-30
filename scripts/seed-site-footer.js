#!/usr/bin/env node
// Seeds `site_footer/main` with the footer the public site already shows, so
// the admin's Footer screen opens on real content and the web app has
// something to render (2026-08-30).
//
//   node scripts/seed-site-footer.js --project=dev
//   node scripts/seed-site-footer.js --project=dev --execute
//   node scripts/seed-site-footer.js --project=dev --execute --force
//
// Dry-run by default, like every script in this folder.
//
// ONE DOCUMENT, for the same reason as site_navigation: the footer is on
// every page, so a half-applied write is a broken footer site-wide. It is
// also small - three columns and fourteen links.
//
// WHAT IS NOT IN HERE. The address, phone, email and social links are on
// `web_config` and stay there. The footer had been rendering a SECOND
// hardcoded copy of them (web/src/app/shared/utils/data/impact-disciples.data.ts)
// that nobody could edit, which is the actual bug in this area; the fix is to
// point the footer at the config that was already editable, not to seed a
// third copy. One visible consequence: the footer template renders LinkedIn
// and Instagram icons, and the hardcoded file had neither - so if web_config
// carries them, those icons will START APPEARING once the web app ships.
//
// IDEMPOTENT, AND IT WILL NOT OVERWRITE STAFF EDITS. One document id, and an
// existing document is SKIPPED. --force is the deliberate reset back to the
// shipped footer.
//
// DEPLOY ORDER. The web app falls back to its bundled copy when this document
// is missing, so an unseeded environment renders the old footer rather than
// none. That is what makes the order forgiving; the fallback goes in a later
// commit once every environment is seeded.

const {getFirestoreFor, resolveProjectId} = require('./lib/firestore-admin');
// In the shared submodule: the web repo's own spec converts this exact file
// and asserts the result matches what the site renders today. A check like
// that is worthless against a copy.
const SEED = require('../src/common/src/shared/data/site-footer-seed.json');

const COLLECTION = 'site_footer';
const DOC_ID = 'main';

/** Repeats the model's rules rather than importing them - this script runs
 *  under plain node and the model is TypeScript. Kept small, and the same
 *  shape site-footer.model.spec.ts asserts against the real validator. */
function problems(footer) {
  const found = [];
  if (!footer.brandTitle) found.push('no brand title');
  const ids = new Set();
  const link = (l, where) => {
    if (!l.id) found.push(where + ': a link with no id');
    else if (ids.has(l.id)) found.push(where + ': repeats id ' + l.id);
    else ids.add(l.id);
    if (!l.title) found.push(where + ': a link with no title');
    if (l.kind === 'page' && !l.routeKey) found.push(where + ' > ' + l.title + ': a page with no route');
    if (l.kind === 'custom' && !l.url) found.push(where + ' > ' + l.title + ': a link with no address');
    if (l.kind === 'group') found.push(where + ' > ' + l.title + ': a dropdown cannot go in the footer');
  };
  for (const l of footer.brandLinks || []) link(l, 'brand links');
  for (const c of footer.columns || []) {
    if (!c.heading) found.push('a column with no heading');
    if (!c.id) found.push('column "' + c.heading + '" has no id');
    else if (ids.has(c.id)) found.push('column "' + c.heading + '" repeats id ' + c.id);
    else ids.add(c.id);
    if (!(c.links || []).length) found.push('column "' + c.heading + '" has no links');
    for (const l of c.links || []) link(l, 'column "' + c.heading + '"');
  }
  return found;
}

async function main() {
  const args = process.argv.slice(2);
  const projectArg = (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];
  const execute = args.includes('--execute');
  const force = args.includes('--force');

  const projectId = resolveProjectId(projectArg);
  const db = getFirestoreFor(projectId);

  console.log(
    `\nProject: ${projectId}` +
    `${execute ? '  (EXECUTE)' : '  (dry run)'}` +
    `${force ? '  (FORCE - overwrites the stored footer)' : ''}`
  );

  const bad = problems(SEED);
  if (bad.length) {
    console.error('\n  The seed data is not a valid footer:\n');
    for (const p of bad) console.error('    - ' + p);
    console.error('');
    process.exit(1);
  }

  const ref = db.collection(COLLECTION).doc(DOC_ID);
  const snap = await ref.get();

  if (snap.exists && !force) {
    console.log(`\n  SKIP  ${COLLECTION}/${DOC_ID} already exists - pass --force to reset it\n`);
    return;
  }

  console.log(`\n  ${snap.exists ? 'REPLACE' : 'WRITE  '} ${COLLECTION}/${DOC_ID}\n`);
  console.log(`    Title      ${SEED.brandTitle}`);
  console.log(`    Under it   ${(SEED.brandLinks || []).map((l) => l.title).join(' | ')}`);
  console.log(`    Rights     ${SEED.attribution}`);
  let links = (SEED.brandLinks || []).length;
  for (const column of SEED.columns || []) {
    console.log(`    ${column.heading.padEnd(16)} ${(column.links || []).length} link(s)`);
    for (const l of column.links || []) {
      console.log(`      - ${l.title.padEnd(24)} ${l.kind === 'page' ? 'route:' + l.routeKey : l.url}`);
      links++;
    }
  }
  console.log(`    Newsletter ${SEED.newsletterHeading}`);
  console.log(`    Bottom     ${SEED.bottomText}${SEED.bottomLinkLabel || ''}`);
  console.log(`\n  ${(SEED.columns || []).length} column(s), ${links} link(s) in total`);

  if (execute) {
    await ref.set(SEED);
    console.log('  written\n');
  } else {
    console.log('  dry run, nothing changed\n');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
