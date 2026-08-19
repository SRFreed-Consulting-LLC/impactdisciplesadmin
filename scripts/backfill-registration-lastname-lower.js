// One-time (idempotent) backfill: lastNameLower = lastName.toLowerCase() on
// every event-registrations doc missing it - the case-insensitive sort key
// the admin Attendees table's paged orderBy uses (Firestore sorts by code
// point, so "williams" would otherwise outrank "Zonn"). New registrations
// get it stamped by registerForEventHttp / the admin attendee dialog.
//
//   node scripts/backfill-registration-lastname-lower.js --project=dev [--dry-run]

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
    console.error('Usage: node scripts/backfill-registration-lastname-lower.js --project=dev|prod [--dry-run]');
    process.exit(1);
  }
  const dryRun = !!arg('dry-run');
  const db = getFirestoreFor(resolveProjectId(project));
  const snap = await db.collection('event-registrations').get();
  let updated = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    if (typeof data.lastNameLower === 'string') continue;
    updated++;
    if (!dryRun) await doc.ref.update({ lastNameLower: (data.lastName ?? '').toLowerCase() });
  }
  console.log(`${dryRun ? '[dry-run] would update' : 'updated'} ${updated} of ${snap.size} registration(s)`);
})().catch((e) => { console.error(e); process.exit(1); });
