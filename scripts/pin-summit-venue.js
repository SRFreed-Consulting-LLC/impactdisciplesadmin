// One-time (idempotent) pinning of THE Summit venue for the 2026-08
// restructure: Summit events always happen at Crossroads Church HWY 16
// Campus - the one `locations` doc that carries trainingrooms. Sets
// isSummitVenue: true on it (and asserts no other doc has the flag or
// rooms), then verifies every isSummit event points at it.
//
//   node scripts/pin-summit-venue.js --project=dev [--dry-run]

const { resolveProjectId, getFirestoreFor } = require('./lib/firestore-admin');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}`));
  if (!hit) return undefined;
  const [, value] = hit.split('=');
  return value === undefined ? true : value;
};

(async () => {
  const project = arg('project');
  if (!project) {
    console.error('Usage: node scripts/pin-summit-venue.js --project=dev|prod [--dry-run]');
    process.exit(1);
  }
  const dryRun = !!arg('dry-run');
  const db = getFirestoreFor(resolveProjectId(project));

  const locSnap = await db.collection('locations').get();
  const withRooms = locSnap.docs.filter((d) => (d.data().trainingrooms ?? []).length > 0);
  const flagged = locSnap.docs.filter((d) => d.data().isSummitVenue === true);

  if (withRooms.length !== 1) {
    console.error(`Expected exactly 1 location with trainingrooms, found ${withRooms.length}:`);
    withRooms.forEach((d) => console.error(`  ${d.id} "${d.data().name}" (${(d.data().trainingrooms ?? []).length} rooms)`));
    process.exit(1);
  }
  const venue = withRooms[0];
  console.log(`Summit venue: ${venue.id} "${venue.data().name}" - ${(venue.data().trainingrooms ?? []).length} rooms`);

  const strayFlags = flagged.filter((d) => d.id !== venue.id);
  if (strayFlags.length) {
    console.error('Other docs already carry isSummitVenue - resolve manually first:');
    strayFlags.forEach((d) => console.error(`  ${d.id} "${d.data().name}"`));
    process.exit(1);
  }

  if (venue.data().isSummitVenue === true) {
    console.log('already flagged - nothing to write');
  } else if (dryRun) {
    console.log(`[dry-run] would set isSummitVenue: true on ${venue.id}`);
  } else {
    await venue.ref.update({ isSummitVenue: true });
    console.log(`flagged ${venue.id}`);
  }

  const summits = await db.collection('events').where('isSummit', '==', true).get();
  for (const ev of summits.docs) {
    const loc = ev.data().location;
    const locId = typeof loc === 'string' ? loc : loc?.id;
    const ok = locId === venue.id;
    console.log(`summit ${ev.id} "${ev.data().eventName}": location=${locId ?? '(none)'} ${ok ? 'OK' : '<-- DOES NOT MATCH the pinned venue'}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
