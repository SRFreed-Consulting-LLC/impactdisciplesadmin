const {tenantCollection} = require("./lib/tenancy");
// Moves the HOME page onto the section kit.
//
//   node scripts/cutover-home.js --project=dev            (dry run)
//   node scripts/cutover-home.js --project=dev --execute
//
// Dry-run by default. DEV ONLY, enforced - the prod cutover ships with the
// branch's own release, not from here.
//
// WHAT IT READS, because the home page is three sources rather than one:
//   home_sections     - the sections and their order
//   home_page_images  - the slider's slides, a collection of their own
//   events            - the summit, whose startDate is what today's banner
//                       counts down to
//
// WHAT IT WRITES: page_content/home, one document, in the kit's vocabulary -
// the same shape every other page now has. The slides become the slider
// section's entries and the summit date becomes the countdown's own
// `targetDate`, so neither depends on another collection afterwards.
//
// The transform is toKitHomeBlocks() from the shared kit - the SAME function
// the comparison screen renders, which is what makes an approval there mean
// something here. There is no second implementation.
//
// NOTHING IS DELETED. home_sections and home_page_images are left exactly as
// they are: this is a copy, so the old screens keep working until their code
// is removed, and a mistake is reversible by deleting one document.

const path = require('path');
const {execSync} = require('child_process');
const {getFirestoreFor, resolveProjectId} = require('./lib/firestore-admin');

/** Compile the shared kit to plain CommonJS in the scratch dir and require
 *  it - the ONLY way a node script can run the genuine transform. */
function loadKit() {
  const outDir = path.join(require('os').tmpdir(), 'impact-kit-cutover-home');
  const src = path.join(__dirname, '..', 'src', 'common', 'src', 'shared', 'lists');
  execSync(
    'npx tsc "' + path.join(src, 'section_kit.ts') + '" "'
    + path.join(src, 'page_section_types.enum.ts') + '"'
    + ' --module commonjs --target es2020 --outDir "' + outDir + '" --skipLibCheck',
    {cwd: path.join(__dirname, '..'), stdio: 'pipe'}
  );
  return require(path.join(outDir, 'section_kit.js'));
}

/** Firestore hands dates back in three shapes across this data - see
 *  MIGRATION.md. The countdown stores ONE: an ISO string. */
function toIso(value) {
  if (!value) {
    return '';
  }
  if (typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  if (typeof value._seconds === 'number') {
    return new Date(value._seconds * 1000).toISOString();
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const projectArg = (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];
  const projectId = resolveProjectId(projectArg);

  if (/a82a8|prod/i.test(projectId)) {
    console.error('REFUSED: dev-only. The prod cutover ships with the branch release.');
    process.exit(1);
  }

  const {toKitHomeBlocks} = loadKit();
  const db = getFirestoreFor(projectId);

  const existing = await db.doc('page_content/home').get();
  if (existing.exists && !args.includes('--force')) {
    console.error(
      'REFUSED: page_content/home already exists. Home has been cut over.\n'
      + 'Re-running would overwrite whatever has been edited since. Pass --force '
      + 'only if you mean to discard it.'
    );
    process.exit(1);
  }

  const [sectionSnap, slideSnap, eventSnap] = await Promise.all([
    db.collection('home_sections').get(),
    db.collection('home_page_images').get(),
    tenantCollection(db, "events").where('isSummit', '==', true).get()
  ]);

  // Only what a visitor sees, in the order they see it - the same rule the
  // live page applies, so the flip cannot silently promote a switched-off
  // section or reorder anything.
  const sections = sectionSnap.docs
    .map((d) => ({id: d.id, ...d.data()}))
    .filter((s) => s.isActive)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const slides = slideSnap.docs
    .map((d) => ({id: d.id, ...d.data()}))
    .filter((s) => s.isActive)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((s) => ({
      title: s.title,
      description: s.text,
      image: s.image,
      ctaTitle: s.ctaTitle,
      link: s.ctaUrl || s.ctaDestination,
      isActive: true
    }));

  // The same event the live banner picks: the first isSummit, no isActive
  // filter. Matching it is what makes the migrated clock read like today's.
  const summit = eventSnap.docs.map((d) => d.data()).find((e) => e.isSummit);
  const countdownTo = summit ? toIso(summit.startDate) : '';

  const {blocks, problems} = toKitHomeBlocks(sections, {slides, countdownTo});

  console.log('HOME -> section kit  (project: ' + projectId + ')');
  console.log('  sections read : ' + sections.length + ' live of ' + sectionSnap.size);
  console.log('  slides folded : ' + slides.length + ' of ' + slideSnap.size);
  console.log('  countdown to  : ' + (countdownTo || '(none found - the band will draw no clock)'));
  console.log('');
  blocks.forEach((b, i) => {
    const extra = b.items ? ', ' + b.items.length + ' entries' : '';
    console.log('  ' + String(i + 1).padStart(2) + '. ' + String(b.key).padEnd(18)
      + ' -> ' + String(b.type).padEnd(12) + ' / ' + String(b.variant || '-').padEnd(12)
      + ' on ' + String(b.surface || 'inherit') + extra);
  });

  if (problems.length) {
    console.error('\nREFUSED: ' + problems.length + ' section(s) have no mapping:');
    problems.forEach((p) => console.error('  - ' + p));
    console.error('The kit would not draw these. Nothing written.');
    process.exit(1);
  }

  if (!execute) {
    console.log('\nDry run. Re-run with --execute to write page_content/home.');
    return;
  }

  await db.doc('page_content/home').set({
    title: 'Home',
    theme: {surface: 'light', banding: false},
    blocks
  });

  console.log('\nWritten: page_content/home (' + blocks.length + ' sections).');
  console.log('home_sections and home_page_images are UNTOUCHED - delete this one');
  console.log('document to undo.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
