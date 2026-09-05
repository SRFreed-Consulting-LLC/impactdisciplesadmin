// Uploads the level-corrected Seminars picture-row images and repoints the
// four entries at them.
//
//   node scripts/replace-seminar-images.js --project=prod --from=<dir>
//   node scripts/replace-seminar-images.js --project=prod --from=<dir> --execute
//
// Dry-run by default.
//
// WHY. The four images on the Seminars page's "Approved Plan for Growing Your
// Church" list were exported with their whole tonal range crushed into the
// bottom of the scale - no pixel in any of them above luminance 98, one
// topping out at 49 - so they rendered as dark smears on the card's black
// ground. Nothing in the CSS was darkening them; the files were dark. The
// detail was still in there, compressed, and a per-channel levels stretch
// recovered it.
//
// UPLOADED UNDER NEW NAMES, never over the originals. The old files stay
// exactly where they are, so undoing this is a matter of pointing the four
// entries back - which is the only reason it is safe to do this to a live
// page in one step.
//
// The download URL is built the way the Firebase SDK builds it: a
// firebaseStorageDownloadTokens metadata value, then
// /o/<url-encoded path>?alt=media&token=<that>. Uploading without that token
// gives an object no unauthenticated visitor can read - the picture would
// simply not appear on the site, with nothing in the admin to explain why.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {tenantPath} = require('./lib/tenancy');
const {getFirestoreFor, resolveProjectId, initializeApp, applicationDefault} =
  require('./lib/firestore-admin');

const functionsDir = path.join(__dirname, '..', 'functions');
const {getStorage} = require(
  require.resolve('firebase-admin/storage', {paths: [functionsDir]})
);

/** Which entry gets which file, keyed by the entry's title. */
const REPLACEMENTS = [
  {title: 'The Mission:', file: 'seminar-mission-restored.png', name: 'Shared/seminar-mission-v2'},
  {title: 'The Model:', file: 'seminar-model-restored.png', name: 'Shared/seminar-model-v2'},
  {title: 'The Method:', file: 'seminar-method-restored.png', name: 'Shared/seminar-method-v2'},
  {title: 'The Takeaways:', file: 'seminar-takeaway-restored.png', name: 'Shared/seminar-takeaway-v2'}
];

const BUCKETS = {
  'impactdisciples-a82a8': 'impactdisciples-a82a8.appspot.com',
  'impactdisciplesdev': 'impactdisciplesdev.appspot.com'
};

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const projectId = resolveProjectId(
    (args.find((a) => a.startsWith('--project=')) || '').split('=')[1]);
  const from = (args.find((a) => a.startsWith('--from=')) || '').split('=')[1];

  if (!from) {
    console.error('Missing --from=<directory holding the *-restored.png files>');
    process.exit(1);
  }
  const bucketName = BUCKETS[projectId];
  if (!bucketName) {
    console.error(`No bucket known for ${projectId}`);
    process.exit(1);
  }

  console.log(`project: ${projectId}`);
  console.log(`bucket : ${bucketName}${execute ? '   (WRITING)' : '   (dry run)'}\n`);

  const db = getFirestoreFor(projectId);
  const ref = db.collection(tenantPath('page_content')).doc('seminars');
  const snap = await ref.get();
  const blocks = snap.data().blocks || [];
  const block = blocks.find((b) => b.key === 'missions');
  if (!block) {
    console.error('No "missions" section on the Seminars page.');
    process.exit(1);
  }

  const app = initializeApp(
    {credential: applicationDefault(), projectId, storageBucket: bucketName},
    `storage::${projectId}`);
  const bucket = getStorage(app).bucket();

  const planned = [];
  for (const r of REPLACEMENTS) {
    const local = path.join(from, r.file);
    if (!fs.existsSync(local)) {
      console.error(`  MISSING ${local}`);
      process.exit(1);
    }
    const item = block.items.find((i) => i.title === r.title);
    if (!item) {
      console.error(`  no entry titled ${JSON.stringify(r.title)}`);
      process.exit(1);
    }
    const dest = `tenants/impactdisciples.com/Web-Pages/${r.name}.png`;
    console.log(`  ${r.title.padEnd(16)} ${(fs.statSync(local).size / 1024).toFixed(0)} kB`);
    console.log(`      was: ${item.image ? item.image.name : '(none)'}`);
    console.log(`      to : ${dest}`);
    planned.push({...r, local, item, dest});
  }

  if (!execute) {
    console.log('\nDry run. Re-run with --execute to upload and repoint.');
    return;
  }

  for (const p of planned) {
    const token = crypto.randomUUID();
    await bucket.upload(p.local, {
      destination: p.dest,
      metadata: {
        contentType: 'image/png',
        cacheControl: 'public, max-age=31536000',
        metadata: {firebaseStorageDownloadTokens: token}
      }
    });
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucketName}` +
      `/o/${encodeURIComponent(p.dest)}?alt=media&token=${token}`;
    // The previous picture is kept on the entry, exactly as the section
    // editor's own picker does for a section image, so the swap is visibly
    // reversible from the data rather than only from this script's history.
    p.item.previousImage = p.item.image;
    p.item.image = {name: p.name, url};
    console.log(`  uploaded ${p.title}`);
  }

  await ref.update({blocks});
  console.log('\nWritten. The four entries now point at the corrected files;');
  console.log('the originals are untouched in storage and on previousImage.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
