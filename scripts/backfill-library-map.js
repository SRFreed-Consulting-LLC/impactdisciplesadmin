// Builds `library_map/points` for the first time.
//
//   node scripts/backfill-library-map.js --project=prod            (dry run)
//   node scripts/backfill-library-map.js --project=prod --execute
//
// Dry-run by default.
//
// WHY IT EXISTS. onLibraryUserWritten keeps that document in step, but a
// trigger only fires on a write. Without this the public map stays empty
// until somebody happens to sign in - and an empty map on the Discipleship
// Library page says "nobody reads this", which is both wrong and the worst
// possible first impression of the feature. Run it once per project, right
// after the function deploys.
//
// It reuses the function's own pointsFrom(), rather than reimplementing the
// projection and the jitter: those two are the privacy boundary, they are
// tested in functions/test/library-map.test.js, and a second copy of them
// that drifted would publish something the tests never looked at.

const path = require('path');
const {tenantPath} = require('./lib/tenancy');
const {getFirestoreFor, resolveProjectId} = require('./lib/firestore-admin');

const functionsDir = path.join(__dirname, '..', 'functions');
// The COMPILED function - `npm --prefix functions run build` first if this
// throws. Deliberately not a re-implementation; see the note above.
const {pointsFrom} = require(path.join(functionsDir, 'lib', 'library-map.functions'));

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const projectId = resolveProjectId(
    (args.find((a) => a.startsWith('--project=')) || '').split('=')[1]);

  console.log(`project: ${projectId}${execute ? '   (WRITING)' : '   (dry run)'}\n`);

  const db = getFirestoreFor(projectId);
  const snap = await db.collection(tenantPath('libraryUsers')).get();
  const points = pointsFrom(snap.docs.map((d) => [d.id, d.data()]));

  console.log(`${snap.size} library users`);
  console.log(`${points.length} with a usable location -> ${points.length} dots`);
  console.log(`${snap.size - points.length} skipped (no location, or one that ` +
    'could not be read)');

  // Proof, in the output, that nothing else came across. The same assertion
  // the function's own test makes, said where a human running this will see
  // it.
  const keys = new Set(points.flatMap((p) => Object.keys(p)));
  console.log(`\nfields published per dot: ${[...keys].sort().join(', ') || '(none)'}`);
  if ([...keys].some((k) => k !== 'lat' && k !== 'lng')) {
    console.error('REFUSED: a point carries something other than lat/lng.');
    process.exit(1);
  }

  if (!execute) {
    console.log('\nDry run. Re-run with --execute to write.');
    return;
  }

  await db.collection(tenantPath('library_map')).doc('points').set({
    points,
    total: points.length,
    updatedAt: Date.now(),
  });
  console.log('\nWritten to library_map/points.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
