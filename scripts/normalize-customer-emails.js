// One-time (idempotent) backfill: customers.email = email.trim().toLowerCase().
//
// WHY. Both customer-upsert triggers normalize the address they SEARCH for
// (`data.email.trim().toLowerCase()`) but the stored column was never
// normalized, so `where("email", "==", email)` misses any record stored with
// different casing and falls through to the create branch. That is an active
// duplicate generator, not a tidy-up: prod holds
// kclatimore@yahoo.com AND Kclatimore@yahoo.com - the same person, forked on
// a later order. 131 customers are non-lowercase; 27 of them already have a
// purchase stored with the same casing, so they are unreachable today.
//
// Run AFTER the transactional-upsert fix is deployed, or the race can mint
// new duplicates while this runs.
//
// COLLISIONS. Where normalizing would make a record collide with an existing
// lowercase one, this script refuses to touch EITHER and reports the pair -
// that is a merge decision (which record is canonical, what happens to the
// differing fields), not a rewrite. Prod has exactly one such pair.
//
//   node scripts/normalize-customer-emails.js --project=dev [--execute]
//
// Dry-run is the DEFAULT here, unlike the older backfills that default to
// writing: this one rewrites a join key.

const { resolveProjectId, getFirestoreFor } = require('./lib/firestore-admin');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}`));
  if (!hit) return undefined;
  const [, value] = hit.split('=');
  return value === undefined ? true : value;
};

const normalize = (value) => String(value ?? '').trim().toLowerCase();

(async () => {
  const project = arg('project');
  if (!project) {
    console.error('Usage: node scripts/normalize-customer-emails.js --project=dev|prod [--execute]');
    process.exit(1);
  }
  const execute = !!arg('execute');
  const db = getFirestoreFor(resolveProjectId(project));
  const snap = await db.collection('customers').select('email').get();

  // Group by normalized address so a rewrite that would collide is visible
  // BEFORE anything is written.
  const byNormalized = new Map();
  snap.docs.forEach((doc) => {
    const key = normalize(doc.get('email'));
    if (!key) return;
    if (!byNormalized.has(key)) byNormalized.set(key, []);
    byNormalized.get(key).push(doc);
  });

  const rewrites = [];
  const collisions = [];
  snap.docs.forEach((doc) => {
    const raw = String(doc.get('email') ?? '');
    const key = normalize(raw);
    if (!key || raw === key) return;               // already normalized
    if (byNormalized.get(key).length > 1) {
      collisions.push({ key, ids: byNormalized.get(key).map((d) => d.id) });
      return;
    }
    rewrites.push({ ref: doc.ref, id: doc.id, from: raw, to: key });
  });

  console.log(`${snap.size} customer(s) scanned`);
  console.log(`${rewrites.length} safe to normalize in place`);
  console.log(`${collisions.length} blocked by a collision - MERGE THESE BY HAND:`);
  collisions.forEach((c) => console.log(`   ${c.key}  ->  ${c.ids.join(' , ')}`));

  if (!execute) {
    console.log('\n[dry-run] nothing written. Re-run with --execute to apply.');
    rewrites.slice(0, 10).forEach((r) => console.log(`   would set ${r.id}: ${JSON.stringify(r.from)} -> ${JSON.stringify(r.to)}`));
    if (rewrites.length > 10) console.log(`   ... and ${rewrites.length - 10} more`);
    return;
  }

  // Batched at 400 (under Firestore's 500-write cap) - the same shape the
  // other backfills use, and small enough that a 429 retry is cheap.
  let written = 0;
  for (let i = 0; i < rewrites.length; i += 400) {
    const chunk = rewrites.slice(i, i + 400);
    const batch = db.batch();
    chunk.forEach((r) => batch.update(r.ref, { email: r.to }));
    await batch.commit();
    written += chunk.length;
    console.log(`   committed ${written}/${rewrites.length}`);
  }
  console.log(`normalized ${written} customer email(s); ${collisions.length} left for manual merge`);
})().catch((e) => { console.error(e); process.exit(1); });
