#!/usr/bin/env node
// Seeds `site_navigation/main` with the public site's top menu, so the admin's
// Navigation screen opens on the real menu and the web app has something to
// render (2026-08-29).
//
//   node scripts/seed-site-navigation.js --project=dev
//   node scripts/seed-site-navigation.js --project=dev --execute
//   node scripts/seed-site-navigation.js --project=dev --execute --force
//
// Dry-run by default, like every script in this folder.
//
// WHY ONE DOCUMENT. The whole menu is one document because a reorder has to
// be atomic - a half-applied write is a scrambled site header on every page,
// which is a worse failure than anything a per-item collection would buy.
// It is also tiny: eight items and thirteen children.
//
// WHAT THIS IS CONVERTED FROM, AND THE ONE PLACE IT DELIBERATELY DIFFERS.
// The web repo carries TWO hand-maintained arrays in nav-menu-data.ts -
// `menuData` for desktop and `mobileMenuData` for mobile - and they had
// drifted apart with nothing asserting either:
//
//   * mobile's Store was a flat link with no dropdown, so IMPACT MERCHANDISE
//     COULD NOT BE REACHED FROM A PHONE AT ALL;
//   * IMPACT GOLF TOURNAMENT was missing from mobile entirely.
//
// This seed is the DESKTOP menu, item for item, because that is the complete
// one. Both menus will render from it, so seeding it fixes those two holes as
// a side effect. That is intended and was Shane's call (2026-08-29): "1 menu
// configuration that works for both is the goal." The web repo's
// nav-menu-data.spec.ts pins both holes in their broken state on purpose -
// those assertions are MEANT to go red when the switchover lands.
//
// IDEMPOTENT, AND IT WILL NOT OVERWRITE STAFF EDITS. There is one document
// id and an existing document is SKIPPED rather than rewritten - somebody may
// have already reordered the menu through the admin. --force is the
// deliberate reset back to the shipped menu.
//
// SPANISH RESOURCES AND THE TWO OFF-SITE LINKS ARE CUSTOM LINKS, not
// catalogue pages. The catalogue names pages; '/store?category=spanish-resources'
// is a filtered view of one, which is an address rather than a page, and
// site-navigation.model.spec.ts asserts no catalogue route carries a query.
//
// DEPLOY ORDER. The web app falls back to its bundled nav-menu-data.ts when
// this document is missing, so an unseeded environment renders the old menu
// rather than no menu - deliberately, because "no navigation on any page" is
// the worst failure this change could ship. That fallback is what makes the
// order forgiving; it is removed in a later commit once every environment is
// confirmed seeded. Until then: seed, verify, then deploy.

const {getFirestoreFor, resolveProjectId} = require('./lib/firestore-admin');
// In the SHARED SUBMODULE, not beside this script. It is the canonical
// starting menu rather than admin tooling, and the web repo's own spec
// converts this exact file and asserts the result is identical to the menu
// the site renders today - a check that would be worthless against a copy.
const SEED = require('../src/common/src/shared/data/site-navigation-seed.json');

const COLLECTION = 'site_navigation';
const DOC_ID = 'main';

/** Where a visitor actually lands, for the dry-run listing - so a wrong link
 *  is visible BEFORE the write rather than after somebody clicks it. */
function destination(item) {
  if (item.kind === 'group') {
    return '(dropdown)';
  }
  if (item.kind === 'custom') {
    return item.url + (item.external ? '  [new tab]' : '');
  }
  return 'route:' + item.routeKey;
}

function flags(item) {
  const bits = [];
  if (item.highlight) bits.push('highlight');
  if (!item.visible) bits.push('HIDDEN');
  return bits.length ? '  ' + bits.join(' + ') : '';
}

/** Repeats the model's own rules rather than importing them: this script runs
 *  under plain node against compiled-nothing, and the shared model is
 *  TypeScript. Kept deliberately small and checked against the real validator
 *  by site-navigation.model.spec.ts's "accepts a menu shaped like the real
 *  one" case, which is built from this same shape. */
function problems(items) {
  const found = [];
  const ids = new Set();
  const walk = (item, depth, path) => {
    const where = path ? path + ' > ' + item.title : item.title;
    if (!item.id) found.push(where + ' has no id');
    else if (ids.has(item.id)) found.push(where + ' repeats id ' + item.id);
    else ids.add(item.id);
    if (!item.title) found.push('an item under ' + (path || 'the top level') + ' has no title');
    if (item.kind === 'page' && !item.routeKey) found.push(where + ' is a page with no route');
    if (item.kind === 'custom' && !item.url) found.push(where + ' is a link with no address');
    if (item.kind === 'group' && !(item.children || []).length) found.push(where + ' is an empty dropdown');
    if (item.kind !== 'group' && (item.children || []).length) found.push(where + ' has children but is not a dropdown');
    if ((item.children || []).length && depth >= 2) found.push(where + ' is nested too deep');
    for (const child of item.children || []) walk(child, depth + 1, where);
  };
  for (const item of items) walk(item, 1, '');
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
    `${force ? '  (FORCE - overwrites the stored menu)' : ''}`
  );

  const items = SEED.items;

  // Refuse to write a menu the admin editor would reject. A seed that
  // disagrees with the validator is how a screen ends up unable to save the
  // data it was opened on.
  const bad = problems(items);
  if (bad.length) {
    console.error('\n  The seed data is not a valid menu:\n');
    for (const problem of bad) console.error('    - ' + problem);
    console.error('');
    process.exit(1);
  }

  const ref = db.collection(COLLECTION).doc(DOC_ID);
  const snap = await ref.get();

  if (snap.exists && !force) {
    const stored = (snap.data() || {}).items || [];
    console.log(
      `\n  SKIP  ${COLLECTION}/${DOC_ID} already exists ` +
      `(${stored.length} top-level item(s)) - pass --force to reset it\n`);
    return;
  }

  console.log(`\n  ${snap.exists ? 'REPLACE' : 'WRITE  '} ${COLLECTION}/${DOC_ID}\n`);
  let total = 0;
  for (const item of items) {
    total++;
    console.log(`    ${item.title.padEnd(24)} ${destination(item).padEnd(46)}${flags(item)}`);
    for (const child of item.children || []) {
      total++;
      console.log(`      - ${child.title.padEnd(22)} ${destination(child).padEnd(46)}${flags(child)}`);
    }
  }

  console.log(`\n  ${items.length} top-level, ${total} in total`);

  if (execute) {
    // set(), not merge: --force means "put the menu back to the shipped one",
    // and a merge would leave items an edit had added.
    await ref.set({items});
    console.log('  written\n');
  } else {
    console.log('  dry run, nothing changed\n');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
