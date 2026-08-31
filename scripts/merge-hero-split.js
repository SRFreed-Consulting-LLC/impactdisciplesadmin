// Folds the HERO_SPLIT archetype into HERO_BAND as a second look.
//
//   node scripts/merge-hero-split.js --project=dev            (dry run)
//   node scripts/merge-hero-split.js --project=dev --execute
//
// Dry-run by default. DEV ONLY - the prod run ships with the branch release.
//
// WHY. "Hero with a screenshot" and "Text beside media" looked like
// near-duplicates - same grid, same fields - and the owner asked whether they
// could be combined. They should not be: what makes a hero a hero is that it
// carries the page's <h1> and there is exactly one per page, which is true of
// the photo hero and false of every body section.
//
// So the merge went the other way. The two HEROES are one archetype with two
// looks, and "text beside media" stays the repeating body section it is.
//
// TWO CHANGES, both to `variant` - no content moves:
//   heroSplit/*            -> heroBand / besidePicture
//   heroBand/buttonList    -> heroBand / overPhoto
//
// The second is a rename: `buttonList` described how the buttons were stored
// back when the other hero look had fixed slots. Both looks take a list of
// buttons now, so the name said nothing, and a variant key that describes the
// wrong axis is worse than no name.
//
// Also updates scripts/page-content-seed-data.json so a fresh seed produces
// the merged shape.

const fs = require('fs');
const path = require('path');
const {getFirestoreFor, resolveProjectId} = require('./lib/firestore-admin');

/** Returns a description of what changed, or null. */
function convert(block) {
  if (block.type === 'heroSplit') {
    block.type = 'heroBand';
    block.variant = 'besidePicture';
    return 'heroSplit -> heroBand/besidePicture';
  }
  if (block.type === 'heroBand' && block.variant !== 'besidePicture' && block.variant !== 'overPhoto') {
    const was = block.variant || '(none)';
    block.variant = 'overPhoto';
    return `heroBand/${was} -> heroBand/overPhoto`;
  }
  return null;
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
  const snap = await db.collection('page_content').get();
  const writes = [];

  for (const doc of snap.docs) {
    const blocks = doc.data().blocks || [];
    let touched = false;
    for (const block of blocks) {
      const what = convert(block);
      if (what) {
        touched = true;
        console.log('  ' + doc.id.padEnd(26) + what);
      }
    }
    if (touched) {
      writes.push({ref: doc.ref, blocks});
    }
  }

  const seedPath = path.join(__dirname, 'page-content-seed-data.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  let seedTouched = 0;
  for (const key of Object.keys(seed)) {
    const blocks = seed[key].blocks || seed[key];
    if (!Array.isArray(blocks)) {
      continue;
    }
    for (const block of blocks) {
      if (convert(block)) {
        seedTouched++;
      }
    }
  }

  console.log('\n' + writes.length + ' page(s) and ' + seedTouched + ' seed section(s).');

  if (!execute) {
    console.log('Dry run. Re-run with --execute to write.');
    return;
  }

  for (const w of writes) {
    await w.ref.update({blocks: w.blocks});
  }
  fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2) + '\n');
  console.log('Written.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
