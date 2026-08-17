// Copy the nested library content (librarySeries + all nested books/units/
// lessons/translations) from the DEV default database into a destination
// project's default database, PRESERVING every document id and the
// subcollection structure verbatim. This is the "migrate the series over
// first" step - the user/submission migration matches book access by title
// against this content, so it must land before users are imported.
//
//   SOURCE: impactdisciplesdev / (default)  -> librarySeries/{s}/books/{b}/
//           units/{u}/lessons/{l}/translations/{t}
//   DEST:   <DEST_PROJECT> / (default)      (default: impactdisciples-a82a8)
//
// The "Impact Discipleship 2026" series (de1-series) is EXCLUDED per
// direction - it carries a duplicate "Impact One" that collides on title and
// breaks the access mapping. Override with IGNORE_SERIES="id1,id2".
//
// SAFETY:
//   - Additive only: writes the librarySeries tree, which does not exist in
//     prod yet. Never deletes or edits any other prod collection.
//   - Ids are preserved, so a re-run overwrites its own output idempotently
//     (set() per doc) and never forks new ids.
//   - Modes: default DRY RUN (counts everything, writes nothing);
//     DRY_RUN=false to actually copy.
//
// Usage (from the admin repo root):
//   node scripts/migrate-library-content-dev-to-prod.js            # dry run
//   DRY_RUN=false node scripts/migrate-library-content-dev-to-prod.js
//   DEST_PROJECT=impactdisciplesdev DRY_RUN=false node scripts/... # (self-copy test)

const { getFirestoreFor } = require('./lib/firestore-admin.js');

const SOURCE_PROJECT = 'impactdisciplesdev';
const DEST_PROJECT = process.env.DEST_PROJECT || 'impactdisciples-a82a8';
const DRY_RUN = process.env.DRY_RUN !== 'false';
const IGNORE_SERIES = new Set(
  (process.env.IGNORE_SERIES || 'de1-series').split(',').map((s) => s.trim()).filter(Boolean)
);

const counts = { series: 0, books: 0, units: 0, lessons: 0, translations: 0, otherDocs: 0 };

// Recursively copy a source doc ref's subcollections into the matching dest
// doc ref, preserving ids. Copies EVERY subcollection found (so nothing is
// silently dropped if the schema grows), tallying the known ones by name.
async function copySubcollections(srcRef, dstRef, dst) {
  const subs = await srcRef.listCollections();
  for (const sub of subs) {
    const key = counts[sub.id] !== undefined ? sub.id : 'otherDocs';
    const docsSnap = await sub.get();
    for (const d of docsSnap.docs) {
      counts[key] = (counts[key] || 0) + 1;
      const childDst = dstRef.collection(sub.id).doc(d.id);
      if (!DRY_RUN) await childDst.set(d.data());
      await copySubcollections(d.ref, childDst, dst);
    }
  }
}

(async () => {
  console.log(DRY_RUN ? '=== DRY RUN (no writes) ===' : '=== LIVE RUN (writing) ===');
  console.log(`SOURCE: ${SOURCE_PROJECT} / (default)`);
  console.log(`DEST:   ${DEST_PROJECT} / (default)`);
  console.log(`Ignoring series: ${[...IGNORE_SERIES].join(', ') || '(none)'}\n`);

  const src = getFirestoreFor(SOURCE_PROJECT);
  const dst = getFirestoreFor(DEST_PROJECT);

  const seriesSnap = await src.collection('librarySeries').get();
  for (const s of seriesSnap.docs) {
    if (IGNORE_SERIES.has(s.id)) { console.log(`  (skip series ${s.id} "${s.data().title}")`); continue; }
    counts.series++;
    const dstSeries = dst.collection('librarySeries').doc(s.id);
    if (!DRY_RUN) await dstSeries.set(s.data());
    console.log(`  series ${s.id} "${s.data().title}"`);
    await copySubcollections(s.ref, dstSeries, dst);
  }

  console.log('\n--- Content tallied ---');
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
  console.log(DRY_RUN ? '\nDry run complete. No writes made.' : '\nLive copy complete.');
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
