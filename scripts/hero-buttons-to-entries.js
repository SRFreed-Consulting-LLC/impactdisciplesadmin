const {tenantCollection} = require("./lib/tenancy");
// Turns a hero band's two fixed button slots into ENTRIES.
//
//   node scripts/hero-buttons-to-entries.js --project=dev            (dry run)
//   node scripts/hero-buttons-to-entries.js --project=dev --execute
//
// Dry-run by default. DEV ONLY - the prod run ships with the branch release.
//
// WHY. The hero band had two looks: "title and buttons" (two fixed slots) and
// "title and a list of buttons" (entries). The choice bought nothing - a list
// does everything the slots do and more - and it asked staff to decide how
// many buttons they wanted before they had written any. So the kit has ONE
// hero look now (owner, 2026-08-31), and it takes entries.
//
// Which leaves seven live heroes holding buttons in the old shape. They would
// still RENDER - the renderer keeps a fallback for documents written before
// the merge - but they would be invisible in the editor, which lists entries.
// This moves them across so they can be edited, reordered, and added to.
//
// Also updates scripts/page-content-seed-data.json, so a fresh seed produces
// the new shape rather than re-creating the old one.

const fs = require('fs');
const path = require('path');
const {getFirestoreFor, resolveProjectId} = require('./lib/firestore-admin');

/** The two slots, in order, as button entries. Skips an empty slot rather
 *  than writing a button with no words on it. */
function slotsToEntries(block) {
  const entries = [];
  if (block.ctaTitle) {
    entries.push({title: block.ctaTitle, link: block.ctaUrl || '', isActive: true});
  }
  if (block.ctaTitle2) {
    entries.push({title: block.ctaTitle2, link: block.ctaUrl2 || '', isActive: true});
  }
  return entries;
}

/** Returns true when the block changed. */
function convert(block) {
  if (block.type !== 'heroBand') {
    return false;
  }
  const entries = slotsToEntries(block);
  const already = Array.isArray(block.items) && block.items.length > 0;

  // A hero that already has entries keeps them - re-running must not append
  // the same two buttons a second time.
  if (!already && entries.length) {
    block.items = entries;
  }
  delete block.ctaTitle;
  delete block.ctaUrl;
  delete block.ctaTitle2;
  delete block.ctaUrl2;
  block.variant = 'buttonList';
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const projectId = resolveProjectId((args.find((a) => a.startsWith('--project=')) || '').split('=')[1]);

  if (/a82a8|prod/i.test(projectId)) {
    console.error('REFUSED: dev-only. The prod run ships with the branch release.');
    process.exit(1);
  }

  const db = getFirestoreFor(projectId);
  const snap = await tenantCollection(db, "page_content").get();
  const writes = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const blocks = data.blocks || [];
    let touched = false;

    for (const block of blocks) {
      if (block.type !== 'heroBand') {
        continue;
      }
      const before = [block.ctaTitle, block.ctaTitle2].filter(Boolean);
      if (convert(block)) {
        touched = true;
        console.log('  ' + doc.id.padEnd(26)
          + (before.length ? before.length + ' button(s) -> entries: ' + before.join(', ')
            : 'no buttons, variant -> buttonList'));
      }
    }
    if (touched) {
      writes.push({ref: doc.ref, blocks});
    }
  }

  console.log('\n' + writes.length + ' page(s) to update.');

  // The seed carries the same shape and would undo this on a fresh seed.
  const seedPath = path.join(__dirname, 'page-content-seed-data.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  let seedTouched = 0;
  for (const key of Object.keys(seed)) {
    const blocks = seed[key].blocks || seed[key];
    if (!Array.isArray(blocks)) {
      continue;
    }
    for (const block of blocks) {
      if (block.type === 'heroBand' && convert(block)) {
        seedTouched++;
      }
    }
  }
  console.log(seedTouched + ' hero(es) in the seed file.');

  if (!execute) {
    console.log('\nDry run. Re-run with --execute to write.');
    return;
  }

  for (const w of writes) {
    await w.ref.update({blocks: w.blocks});
  }
  fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2) + '\n');
  console.log('\nWritten: ' + writes.length + ' page(s) and the seed file.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
