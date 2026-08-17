// Restore the OLD app's lesson highlights (missed by the first migration
// because they were nested subcollections under empty parent docs, so a
// top-level count() read 0). Source is the RESTORED backup in the
// restore-temp named database.
//
//   SOURCE: impactdisciples-a82a8 / restore-temp
//           highlites/{email}/{oldLessonId}/{highlightId} with the old
//           web-highlighter shape { startMeta, endMeta, text, id }.
//   DEST:   impactdisciples-a82a8 / (default)
//           libraryUsers/{email}/lessonHighlights/{newLessonId} =
//           { lessonId, highlights: [ {id, locale, exact, prefix, suffix,
//           createdAt} ] } (the new text-quote shape).
//
// Format conversion: old.text -> new.exact; prefix/suffix left empty. The
// reader's anchoring (text-quote-anchor.ts) tries prefix+exact+suffix, then
// FALLS BACK to a bare exact first-occurrence match - so empty context still
// re-anchors every highlight whose text still exists in the lesson. This is
// best-effort: a phrase repeated in a lesson lands on its first occurrence;
// a highlight whose text no longer appears is skipped.
//
// Old lesson id -> new lesson id via the (book,unit,lesson) title triple,
// same mapping the submission migration used.
//
// SAFETY: source read-only; only kept users (those with a libraryUsers doc)
// get highlights; existing lessonHighlights docs are MERGED (highlights
// appended, deduped by id), never clobbered. DRY_RUN default; DRY_RUN=false
// to write. Tagged legacyImportHighlights on each written doc.

const { getFirestoreFor } = require('./lib/firestore-admin.js');

const PROJECT = 'impactdisciples-a82a8';
const SOURCE_DB = 'restore-temp';
const DRY_RUN = process.env.DRY_RUN !== 'false';
const MIGRATION_TS = 1786900000000; // fixed stamp for all restored highlights

function titleKey(...p) { return p.map((t) => (t || '').toString().trim().toLowerCase()).join('||'); }

(async () => {
  console.log(DRY_RUN ? '=== DRY RUN (no writes) ===' : '=== LIVE RUN (writing) ===');
  const src = getFirestoreFor(PROJECT, SOURCE_DB);
  const dst = getFirestoreFor(PROJECT);

  // Source lessons/units/books (old ids -> titles)
  const [sLessonsSnap, sUnitsSnap, sBooksSnap] = await Promise.all([
    src.collection('lessons').get(), src.collection('units').get(), src.collection('books').get(),
  ]);
  const sLessons = new Map(sLessonsSnap.docs.map((d) => [d.id, d.data()]));
  const sUnits = new Map(sUnitsSnap.docs.map((d) => [d.id, d.data()]));
  const sBooks = new Map(sBooksSnap.docs.map((d) => [d.id, d.data()]));

  // Dest nested content -> title triple => new lesson id (skip de1-series,
  // the excluded duplicate)
  const destLessonByTriple = new Map();
  const seriesSnap = await dst.collection('librarySeries').get();
  for (const s of seriesSnap.docs) {
    if (s.id === 'de1-series') continue;
    const books = await s.ref.collection('books').get();
    for (const b of books.docs) {
      const units = await b.ref.collection('units').get();
      for (const u of units.docs) {
        const lessons = await u.ref.collection('lessons').get();
        for (const l of lessons.docs) {
          const key = titleKey(b.data().title, u.data().title, l.data().title);
          if (!destLessonByTriple.has(key)) destLessonByTriple.set(key, l.id);
        }
      }
    }
  }

  function mapOldLesson(oldLessonId) {
    const sl = sLessons.get(oldLessonId); if (!sl) return null;
    const su = sUnits.get(sl.unit); const sb = su ? sBooks.get(su.book) : undefined;
    return destLessonByTriple.get(titleKey(sb?.title, su?.title, sl.title)) || null;
  }

  // Which users exist in dest (kept users) - only restore for them
  const keptEmails = new Set((await dst.collection('libraryUsers').get()).docs.map((d) => d.id));

  const userDocs = await src.collection('highlites').listDocuments();
  let usersDone = 0, hlTotal = 0, hlSkippedNoText = 0, hlNoLessonMap = 0, hlWritten = 0, skippedUser = 0;
  const perUserLessons = [];

  for (const uref of userDocs) {
    const email = uref.id.trim().toLowerCase();
    if (!keptEmails.has(email)) { skippedUser++; continue; }
    const lessonSubs = await uref.listCollections();
    const byNewLesson = new Map(); // newLessonId -> [highlight]
    for (const sub of lessonSubs) {
      const newLessonId = mapOldLesson(sub.id);
      const hs = await sub.get();
      for (const h of hs.docs) {
        hlTotal++;
        const data = h.data();
        const text = (data.text || '').toString();
        if (!text.trim()) { hlSkippedNoText++; continue; }
        if (!newLessonId) { hlNoLessonMap++; continue; }
        if (!byNewLesson.has(newLessonId)) byNewLesson.set(newLessonId, []);
        byNewLesson.get(newLessonId).push({
          id: data.id || h.id, locale: '', exact: text, prefix: '', suffix: '', createdAt: MIGRATION_TS,
        });
      }
    }
    usersDone++;
    for (const [newLessonId, highlights] of byNewLesson) {
      perUserLessons.push(`${email} -> ${newLessonId}: ${highlights.length}`);
      hlWritten += highlights.length;
      if (!DRY_RUN) {
        const ref = dst.collection('libraryUsers').doc(email).collection('lessonHighlights').doc(newLessonId);
        const existing = await ref.get();
        let merged = highlights;
        if (existing.exists) {
          const prior = (existing.data().highlights || []);
          const seen = new Set(prior.map((h) => h.id));
          merged = [...prior, ...highlights.filter((h) => !seen.has(h.id))];
        }
        await ref.set({ lessonId: newLessonId, highlights: merged, legacyImportHighlights: true }, { merge: true });
      }
    }
  }

  console.log(`Users with highlights (kept): ${usersDone} | skipped (no dest account): ${skippedUser}`);
  console.log(`Highlights: total ${hlTotal}, skipped-empty-text ${hlSkippedNoText}, no-lesson-map ${hlNoLessonMap}, ${DRY_RUN ? 'would-write' : 'written'} ${hlWritten}`);
  console.log('Per user/lesson (first 20):');
  perUserLessons.slice(0, 20).forEach((l) => console.log('  ' + l));
  console.log(DRY_RUN ? '\nDry run complete. No writes.' : '\nLive restore complete.');
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
