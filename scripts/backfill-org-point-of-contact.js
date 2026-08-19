// One-time (idempotent) backfill for the 2026-08 restructure: split each
// organization's legacy free-text `contactName` into the new structured
// `pointOfContact` {firstName, lastName} - only where contactName is set
// and pointOfContact is absent, so re-runs and admin-edited orgs are
// untouched. contactName itself is left in place (deprecated, read-only).
//
//   node scripts/backfill-org-point-of-contact.js --project=dev [--dry-run]

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
    console.error('Usage: node scripts/backfill-org-point-of-contact.js --project=dev|prod [--dry-run]');
    process.exit(1);
  }
  const dryRun = !!arg('dry-run');
  const db = getFirestoreFor(resolveProjectId(project));

  const snap = await db.collection('organizations').get();
  let updated = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    const name = (data.contactName ?? '').trim();
    if (!name || data.pointOfContact) continue;

    const parts = name.split(/\s+/);
    // First token = firstName, remainder = lastName ("Mary Anne Smith" ->
    // Mary / Anne Smith - imperfect, but this is display seed data the
    // admin can correct on the org screen). Single-token names land in
    // firstName only, so the key is omitted rather than written undefined.
    const pointOfContact = {
      firstName: parts[0],
      ...(parts.length > 1 ? { lastName: parts.slice(1).join(' ') } : {}),
    };
    updated++;
    console.log(`${dryRun ? '[dry-run] would set' : 'set'} ${doc.id} "${data.name ?? '(unnamed)'}": pointOfContact=${JSON.stringify(pointOfContact)}`);
    if (!dryRun) await doc.ref.update({ pointOfContact });
  }
  console.log(`done - ${updated} of ${snap.size} organization(s) ${dryRun ? 'would change' : 'updated'}`);
})().catch((e) => { console.error(e); process.exit(1); });
