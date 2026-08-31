#!/usr/bin/env node
// Cuts ONE approved page from the fourteen archetypes onto the two members
// that replace them - Section and List (2026-08-31).
//
//   node scripts/cutover-sections.js --page=seminars --project=dev
//   node scripts/cutover-sections.js --page=seminars --project=dev --execute
//   node scripts/cutover-sections.js --all --project=dev
//
// Dry-run by default. DEV ONLY, enforced.
//
// THE TRANSFORM IS THE REAL ONE, and that is the whole contract. This script
// COMPILES the submodule's section_kit.ts and calls its toSectionBlocks() -
// the same function /kit-preview ran for every comparison Shane approved on
// 2026-08-31. A hand-copied flip here would be a second implementation free
// to drift from what he actually looked at, which is the one thing this flow
// exists to prevent. It is the same contract cutover-page.js carried through
// the first migration, and it held.
//
// WHAT IT WRITES: `blocks`, merged. Nothing else. `title`, `theme` and
// `isPublished` are already right - these pages were cut over to the kit
// vocabulary earlier the same day and this is a second, narrower move.
//
// IT REFUSES RATHER THAN GUESSES, in four places:
//   - a page with no blocks
//   - a page whose sections are ALREADY Section/List (a re-run)
//   - any section the transform cannot express, listed by name
//   - production, outright
//
// THE ORDER TO RUN IT IN. Web hosting must be carrying the renderer that
// draws Section and List BEFORE any page migrates, or that page renders
// empty on the deployed site. It is deployed to dev as of 2026-08-31; check
// before running this anywhere else.

const {execSync} = require('child_process');
const fs = require('fs');
const path = require('path');
const {getFirestoreFor, resolveProjectId} = require('./lib/firestore-admin');

/** Compile the shared kit to plain CommonJS and require it - the only way a
 *  node script can run the genuine transform rather than a copy of it. */
function loadKit() {
  const outDir = path.join(require('os').tmpdir(), 'impact-kit-sections');
  const src = path.join(__dirname, '..', 'src', 'common', 'src', 'shared', 'lists');
  execSync(
    'npx tsc "' + path.join(src, 'section_kit.ts') + '" "'
    + path.join(src, 'page_section_types.enum.ts') + '"'
    + ' --module commonjs --target es2020 --outDir "' + outDir + '" --skipLibCheck',
    {cwd: path.join(__dirname, '..'), stdio: 'pipe'}
  );
  return require(path.join(outDir, 'section_kit.js'));
}

/** How a migrated section reads in the summary - what it became, and how
 *  much of it there is, so a flip that quietly emptied something shows. */
function describe(block) {
  if (block.type === 'list') {
    return 'list/' + (block.variant || '-') + '  ' + (block.items?.length ?? 0) + ' items';
  }
  if (block.type === 'section') {
    const columns = block.columns ?? [];
    const pieces = columns.reduce((n, c) => n + (c.pieces?.length ?? 0), 0);
    return 'section     ' + columns.length + ' col, ' + pieces + ' pieces'
      + '  [' + columns.map((c) => (c.pieces ?? []).map((p) => p.kind).join('+')).join(' | ') + ']';
  }
  return String(block.type);
}

async function migrate(db, kit, slug, execute) {
  const ref = db.collection('page_content').doc(slug);
  const doc = await ref.get();

  if (!doc.exists || !doc.data().blocks?.length) {
    console.error('  REFUSED: no blocks to flip.');
    return false;
  }

  const before = doc.data().blocks;

  // A RE-RUN IS REFUSED, not made idempotent. Flipping already-flipped data
  // would find no builder for 'section', keep it unchanged, and report a
  // problem - but saying so plainly beats letting somebody read that as a
  // real failure.
  const already = before.filter((b) => b.type === 'section' || b.type === 'list').length;
  if (already) {
    console.error('  REFUSED: ' + already + ' of ' + before.length
      + ' sections are ALREADY Section/List. This page has migrated.');
    return false;
  }

  const {blocks, problems} = kit.toSectionBlocks(before);

  blocks.forEach((b, i) => console.log(
    '   ' + String(i).padStart(2) + ' '
    + String(before[i].type + '/' + (before[i].variant || '-')).padEnd(26)
    + '-> ' + describe(b)));

  if (problems.length) {
    console.error('\n  REFUSED - these sections would be LOST:');
    problems.forEach((p) => console.error('    - ' + p));
    return false;
  }

  if (execute) {
    await ref.set({blocks}, {merge: true});
    console.log('  WRITTEN.');
  }
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const all = args.includes('--all');
  const pageArg = (args.find((a) => a.startsWith('--page=')) || '').split('=')[1];
  const projectArg = (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];

  if (!projectArg) {
    console.error('Missing --project=dev. There is no default.');
    process.exit(1);
  }
  const projectId = resolveProjectId(projectArg);

  // Not a formality: this rewrites the only copy of every public page's
  // words. Production migrates with its own release, deliberately, once dev
  // has been living on this shape.
  if (/a82a8/.test(projectId) || projectArg === 'prod') {
    console.error('REFUSED: dev only. Production migrates with its own release.');
    process.exit(1);
  }
  if (!all && !pageArg) {
    console.error('Give --page=<slug>, or --all to walk every page.');
    process.exit(1);
  }

  const kit = loadKit();
  const db = getFirestoreFor(projectId);

  const slugs = all
    ? (await db.collection('page_content').get()).docs.map((d) => d.id).sort()
    : [pageArg];

  console.log('project:', projectId, execute ? '(EXECUTE)' : '(dry run)');

  let ok = 0;
  let refused = 0;
  for (const slug of slugs) {
    console.log('\n### ' + slug);
    if (await migrate(db, kit, slug, execute)) {
      ok++;
    } else {
      refused++;
    }
  }

  console.log('\n' + ok + ' page(s) ready, ' + refused + ' refused.');
  if (!execute && ok) {
    console.log('DRY RUN. Re-run with --execute to write.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
