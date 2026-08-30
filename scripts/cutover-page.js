#!/usr/bin/env node
// Cuts ONE approved original page over to the section kit (2026-08-30).
//
//   node scripts/cutover-page.js --page=lunch-and-learns --project=dev
//   node scripts/cutover-page.js --page=lunch-and-learns --project=dev --execute
//
// Dry-run by default. DEV ONLY, enforced - the prod cutover happens with the
// branch's own prod release, not from here.
//
// THE TRANSFORM IS THE REAL ONE. This script COMPILES the submodule's
// section_kit.ts and calls its toKitBlocks() - the same function the
// /kit-preview route ran for every comparison Shane approved. A hand-copied
// flip here would be a second implementation that could drift from what he
// looked at, which is the one thing this whole flow exists to prevent.
//
// WHAT IT WRITES (a merge, never a document replace):
//   blocks : the flipped sections
//   title  : the page's name - what marks a document as a KIT page, gives
//            the browser tab its name, and feeds the admin's nav leaf
//   theme  : the page's prevailing ground
// isPublished is deliberately NOT written: absent counts as published, and
// these pages are LIVE.
//
// KNOWN CONSEQUENCE, on purpose: the DEPLOYED dev site still runs the old
// bundle, whose bespoke component does not know the kit vocabulary - that
// page renders EMPTY on the deployed dev site until the branch is deployed.
// The local branch servers render it correctly, which is where review
// happens. Say so, do not discover it.

const {execSync} = require('child_process');
const fs = require('fs');
const path = require('path');
const {getFirestoreFor, resolveProjectId} = require('./lib/firestore-admin');

/** Per-page titles and themes for the cutover - the two fields a bespoke
 *  page never carried. Titles match the nav labels the admin uses. */
const PAGES = {
  'lunch-and-learns': {title: 'Lunch and Learns', theme: {surface: 'light', banding: false}},
  'about-us': {title: 'About Us', theme: {surface: 'light', banding: false}},
  'equipping-groups': {title: 'Equipping Groups', theme: {surface: 'light', banding: false}},
  'equipping-groups-pastors': {title: 'Equipping - Pastors', theme: {surface: 'light', banding: false}},
  'equipping-groups-leaders': {title: 'Equipping - Leaders', theme: {surface: 'light', banding: false}},
  'equipping-groups-churches': {title: 'Equipping - Churches', theme: {surface: 'light', banding: false}},
  'coaching-with-impact': {title: 'Coaching with Impact', theme: {surface: 'light', banding: false}},
  'seminars': {title: 'Seminars', theme: {surface: 'light', banding: false}},
  'give': {title: 'Give', theme: {surface: 'light', banding: false}},
  'contact': {title: 'Contact', theme: {surface: 'light', banding: false}},
  'discipleship-library': {title: 'Discipleship Library', theme: {surface: 'light', banding: false}},
  'prayer-team': {title: 'Prayer Team', theme: {surface: 'light', banding: false}}
};

/** Compile the shared kit to plain CommonJS in the scratch dir and require
 *  it - the ONLY way a node script can run the genuine transform. */
function loadKit() {
  const outDir = path.join(require('os').tmpdir(), 'impact-kit-cutover');
  const src = path.join(__dirname, '..', 'src', 'common', 'src', 'shared', 'lists');
  execSync(
    'npx tsc "' + path.join(src, 'section_kit.ts') + '" "'
    + path.join(src, 'page_section_types.enum.ts') + '"'
    + ' --module commonjs --target es2020 --outDir "' + outDir + '" --skipLibCheck',
    {cwd: path.join(__dirname, '..'), stdio: 'pipe'}
  );
  return require(path.join(outDir, 'section_kit.js'));
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const pageArg = (args.find((a) => a.startsWith('--page=')) || '').split('=')[1];
  const projectArg = (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];
  const projectId = resolveProjectId(projectArg);

  if (/a82a8|prod/i.test(projectId)) {
    console.error('REFUSED: dev-only. The prod cutover ships with the branch release.');
    process.exit(1);
  }
  const meta = PAGES[pageArg];
  if (!meta) {
    console.error('Unknown --page. One of: ' + Object.keys(PAGES).join(', '));
    process.exit(1);
  }

  const {toKitBlocks} = loadKit();
  const db = getFirestoreFor(projectId);
  const ref = db.collection('page_content').doc(pageArg);
  const doc = await ref.get();
  if (!doc.exists || !doc.data().blocks?.length) {
    console.error('REFUSED: ' + pageArg + ' has no blocks to flip.');
    process.exit(1);
  }

  const before = doc.data().blocks;
  const alreadyTitled = !!doc.data().title;
  const {blocks, problems} = toKitBlocks(pageArg, before);

  console.log('project  :', projectId);
  console.log('page     :', pageArg, alreadyTitled ? '(ALREADY has a title - flipped before?)' : '');
  console.log('blocks   :', before.length, '->', blocks.length);
  blocks.forEach((b, i) => console.log(
    '  ' + String(i).padStart(2), String(before[i].type).padEnd(14), '->',
    String(b.type).padEnd(14), String(b.variant ?? '-').padEnd(12), b.surface ?? '-'));
  if (problems.length) {
    console.error('\nREFUSED - unmapped sections would be LOST:');
    problems.forEach((p) => console.error('  - ' + p));
    process.exit(1);
  }

  // Also flip the seed, so a fresh environment is born on the kit
  // vocabulary rather than seeding a page the site can no longer draw.
  const seedPath = path.join(__dirname, 'page-content-seed-data.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const seedFlip = seed[pageArg] ? toKitBlocks(pageArg, seed[pageArg]) : null;

  if (!execute) {
    console.log('\nDRY RUN. Would merge {blocks, title: "' + meta.title
      + '", theme} and flip the seed entry. Re-run with --execute.');
    return;
  }

  await ref.set({blocks, title: meta.title, theme: meta.theme}, {merge: true});
  if (seedFlip && !seedFlip.problems.length) {
    seed[pageArg] = seedFlip.blocks;
    fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2));
    console.log('\nSeed entry flipped too.');
  }
  console.log('Cut over. The LOCAL branch site now draws /' + pageArg
    + ' through the kit; the DEPLOYED dev site shows it empty until the '
    + 'branch deploys.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
