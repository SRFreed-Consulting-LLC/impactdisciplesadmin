// Puts the reader map at the top of the Discipleship Library page.
//
//   node scripts/add-reader-map-header.js --project=prod            (dry run)
//   node scripts/add-reader-map-header.js --project=prod --execute
//
// Dry-run by default. Idempotent: a page that already has a readerMap piece
// is left alone.
//
// A ONE-OFF CONVENIENCE, not a fixture. The map is a content PIECE, so this
// is a placement anybody can make in Page Manager - add a section, drag the
// map in, drag the section to the top. This does it once so the page is
// already right, and so the heading arrives with wording to edit rather than
// an empty box.
//
// The heading is a separate piece rather than text inside the map, because
// wording belongs where staff can change it. Reword it on the page.

const {tenantPath} = require('./lib/tenancy');
const {getFirestoreFor, resolveProjectId} = require('./lib/firestore-admin');

const PAGE_ID = 'discipleship-library';
const HEADING = 'Impact Digital is making disciples all around the world.';

function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const projectId = resolveProjectId(
    (args.find((a) => a.startsWith('--project=')) || '').split('=')[1]);

  return run(projectId, execute);
}

async function run(projectId, execute) {
  console.log(`project: ${projectId}${execute ? '   (WRITING)' : '   (dry run)'}\n`);

  const db = getFirestoreFor(projectId);
  const ref = db.collection(tenantPath('page_content')).doc(PAGE_ID);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`No ${PAGE_ID} page.`);
    process.exit(1);
  }
  const blocks = snap.data().blocks || [];

  const already = JSON.stringify(blocks).includes('"readerMap"');
  if (already) {
    console.log('The page already carries a readerMap piece. Nothing to do.');
    return;
  }

  // Keys must not collide with anything already on the page - a section is
  // tracked by key, and two sections sharing one behave as a single section.
  const taken = new Set(blocks.map((b) => b.key));
  let key = 'reach';
  let n = 2;
  while (taken.has(key)) {
    key = `reach-${n++}`;
  }

  const header = {
    key,
    type: 'section',
    variant: 'columns',
    isActive: true,
    // Dark, because a map reads as a map on a dark ground and the page's own
    // hero directly below it is already dark - two light bands with a dark
    // one wedged between them would look like a mistake.
    surface: 'dark',
    columns: [{
      key: 'col-1',
      align: 'centre',
      pieces: [
        {
          key: 'heading-1',
          kind: 'heading',
          isActive: true,
          text: HEADING,
          // The page's own <h1> stays on the hero below. This is a section
          // heading: two h1s on one page is worse for a screen reader than
          // a smaller headline is for anybody.
          level: 'section'
        },
        {key: 'map-1', kind: 'readerMap', isActive: true}
      ]
    }]
  };

  console.log('new first section:');
  console.log(`   key      ${header.key}`);
  console.log(`   surface  ${header.surface}`);
  console.log(`   heading  ${JSON.stringify(HEADING)}`);
  console.log(`   piece    readerMap`);
  console.log('\nthe page becomes:');
  [header, ...blocks].forEach((b, i) => {
    console.log(`   [${i}] ${b.key} (${b.type}/${b.variant || '-'})`);
  });

  if (!execute) {
    console.log('\nDry run. Re-run with --execute to write.');
    return;
  }

  await ref.update({blocks: [header, ...blocks]});
  console.log('\nWritten. Reorder or reword it in Page Manager like any ' +
    'other section.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
