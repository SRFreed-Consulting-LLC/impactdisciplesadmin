// Turns the hardcoded consultation banner into an ordinary photo band.
//
//   node scripts/merge-consultation-band.js --project=dev            (dry run)
//   node scripts/merge-consultation-band.js --project=dev --execute
//
// Dry-run by default. DEV ONLY - the prod run ships with the branch release.
//
// WHY. `fixedBand` existed for exactly one band. Its heading, its paragraph,
// its picture and its button all lived in the web app's own component, so the
// kit could only offer "a section you cannot edit" - and a section nobody can
// edit is the thing this whole builder exists to remove.
//
// A photo band takes buttons now, which is the only thing it was missing, so
// the consultation band is an ordinary section: same words, same picture,
// same destination, and every one of them editable.
//
// THE TRADE, stated because it is real: this band was identical on all five
// pages BY CONSTRUCTION - one component, one copy. As sections they are five
// independent copies, so changing the wording means editing five pages. The
// owner accepted that on 2026-08-31; the alternative was keeping an archetype
// for one uneditable band.
//
// The content below is lifted verbatim from
// web/src/app/shared/components/consulation-banner/. It is not invented.

const fs = require('fs');
const path = require('path');
const {getFirestoreFor, resolveProjectId} = require('./lib/firestore-admin');

const CONSULTATION = {
  type: 'photoBand',
  variant: 'title',
  surface: 'photo',
  heading: 'RECEIVE A FREE CONSULTATION',
  body: '<p>Your first consultation is on us. Fill out a brief survey and one of '
    + 'our consultants will contact you shortly!</p>',
  image: {
    url: 'https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8.appspot.com/o/'
      + 'Web-Pages%2FHeaders%2Fteam-header.PNG?alt=media&token=96b45f4e-2a72-4068-944a-ae188c4f3090',
    name: 'team-header.PNG'
  },
  items: [
    {title: 'Get My Free Consultation', link: '/consultation-survey', isActive: true}
  ]
};

/** Returns true when the block changed. */
function convert(block) {
  if (block.type !== 'fixedBand') {
    return false;
  }
  Object.assign(block, CONSULTATION, {
    // Keep the block's own identity and switch state - only what it DRAWS
    // changes.
    key: block.key,
    isActive: block.isActive
  });
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
  const snap = await db.collection('page_content').get();
  const writes = [];

  for (const doc of snap.docs) {
    const blocks = doc.data().blocks || [];
    let touched = false;
    for (const block of blocks) {
      if (convert(block)) {
        touched = true;
        console.log('  ' + doc.id.padEnd(26) + block.key + ': fixedBand -> photoBand/title, now editable');
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
