// Migrate the live library users + their lesson submissions from the OLD
// production reader app into the consolidated schema.
//
//   SOURCE: impactdisciples-a82a8, NAMED database "impactdiscipleship-books"
//           - impact-users (151), submissions (121), books/units/lessons
//             (old flat schema, old ids), keyed old->new by TITLE only
//             (no id map was ever persisted; titles were carried verbatim).
//   DEST:   <DEST_PROJECT> DEFAULT database, NESTED schema
//             librarySeries/{s}/books/{b}/units/{u}/lessons/{l}, plus
//             libraryUsers/{email} and libraryUsers/{email}/submissions/{lessonId}.
//
// Ported from the reader repo's stale scripts/backfill-users.js +
// backfill-submissions.js (which targeted a since-deleted named dev db, a
// flat top-level books/units/lessons layout, and wrote libraryUsers via the
// client SDK - now blocked by the owner-only libraryUsers rule). This runs
// via the Admin SDK (rules-exempt) and walks the current nested schema.
//
// SAFETY:
//   - The SOURCE is only ever read, never written.
//   - Modes: `--analyze` (read-only, reports mapping quality), default DRY
//     RUN (maps everything, writes nothing), and DRY_RUN=false (live).
//   - Users: merge:true, only owns the import fields
//     (bookLicenses/licensedBookIds/firstName/lastName/phone/legacyId/
//     legacyImport) - never clobbers userId/lastLogin/theme/prefs the app
//     or the person set. Re-runnable.
//   - Submissions: never overwrite an existing dest submission (someone may
//     have answered fresh in the new app); skip it.
//
// Usage (from the admin repo root):
//   node scripts/migrate-library-users-submissions.js --analyze
//   node scripts/migrate-library-users-submissions.js            # dry run
//   DRY_RUN=false node scripts/migrate-library-users-submissions.js
//   DEST_PROJECT=impactdisciples-a82a8 DRY_RUN=false node scripts/... # prod
//
// DEST_PROJECT defaults to impactdisciplesdev (the dev rehearsal target).

const { getFirestoreFor } = require('./lib/firestore-admin.js');

const SOURCE_PROJECT = 'impactdisciples-a82a8';
const SOURCE_DB = 'impactdiscipleship-books';
const DEST_PROJECT = process.env.DEST_PROJECT || 'impactdisciplesdev';
const ANALYZE_ONLY = process.argv.includes('--analyze');
const DRY_RUN = process.env.DRY_RUN !== 'false';

// Per direction: ignore the "Impact Discipleship 2026" series (de1-series)
// for this migration. It carries a DUPLICATE "Impact One - Discipleship
// Essentials" (de1-book) whose title collides with the canonical copy in the
// "Impact Discipleship" series, which made the title-based license/submission
// mapping ambiguous. Excluding it makes every title unique again. Override
// with IGNORE_SERIES="id1,id2".
const IGNORE_SERIES = new Set(
  (process.env.IGNORE_SERIES || 'de1-series').split(',').map((s) => s.trim()).filter(Boolean)
);

function titleKey(...parts) {
  return parts.map((t) => (t || '').toString().trim().toLowerCase()).join('||');
}

// Handles a real Admin-SDK Timestamp, a legacy plain { seconds, nanoseconds }
// or { _seconds, _nanoseconds } map, or a raw ms number.
function toMillis(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const s = value.seconds ?? value._seconds;
  const n = value.nanoseconds ?? value._nanoseconds ?? 0;
  if (typeof s === 'number') return s * 1000 + Math.floor(n / 1e6);
  return fallback;
}

function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

(async () => {
  console.log(
    ANALYZE_ONLY ? '=== ANALYZE (read-only) ===' : DRY_RUN ? '=== DRY RUN (no writes) ===' : '=== LIVE RUN (writing) ==='
  );
  console.log(`SOURCE: ${SOURCE_PROJECT} / ${SOURCE_DB}`);
  console.log(`DEST:   ${DEST_PROJECT} / (default)\n`);

  const src = getFirestoreFor(SOURCE_PROJECT, SOURCE_DB);
  const dst = getFirestoreFor(DEST_PROJECT);

  // ---- Read source (flat, old ids) ----
  const [usersSnap, sBooksSnap, subsSnap, sLessonsSnap, sUnitsSnap] = await Promise.all([
    src.collection('impact-users').get(),
    src.collection('books').get(),
    src.collection('submissions').get(),
    src.collection('lessons').get(),
    src.collection('units').get(),
  ]);
  const users = usersSnap.docs.map((d) => ({ _id: d.id, ...d.data() }));
  const sBooks = new Map(sBooksSnap.docs.map((d) => [d.id, d.data()]));
  const sLessons = new Map(sLessonsSnap.docs.map((d) => [d.id, d.data()]));
  const sUnits = new Map(sUnitsSnap.docs.map((d) => [d.id, d.data()]));
  const submissions = subsSnap.docs.map((d) => ({ _id: d.id, ...d.data() }));
  console.log(`Source: ${users.length} users, ${sBooks.size} books, ${submissions.length} submissions, ${sLessons.size} lessons.`);

  // ---- Reconcile access from PURCHASE history too ----
  // Access in the old app lived in TWO places: impact-users.bookLicenses AND
  // the store purchase history. ~50 buyers have an empty bookLicenses array
  // but paid for a digital book, so licenses alone would silently drop their
  // access. Union both. Purchases live in a82a8's DEFAULT database (same in
  // prod), keyed by the same old book ids as the licenses. Refunded orders
  // are excluded.
  const purSrc = getFirestoreFor(SOURCE_PROJECT);
  const purByEmail = new Map(); // email -> Map(oldBookId -> earliest purchaseDate ms)
  (await purSrc.collection('purchases').get()).forEach((p) => {
    const x = p.data();
    if (x.refunded) return;
    const email = (x.email || '').trim().toLowerCase();
    if (!email) return;
    const when = toMillis(x.dateProcessed, undefined);
    for (const ci of x.cartItems || []) {
      if ((ci.isDigitalBook || ci.isEBook) && ci.digitalBookId) {
        if (!purByEmail.has(email)) purByEmail.set(email, new Map());
        const m = purByEmail.get(email);
        if (!m.has(ci.digitalBookId) || (when && when < m.get(ci.digitalBookId))) m.set(ci.digitalBookId, when);
      }
    }
  });
  console.log(`Purchase reconciliation: ${purByEmail.size} emails with digital-book purchases.`);

  // ---- Walk dest nested schema -> title indexes ----
  // Each candidate carries { id, published } so that when a title collides
  // across two dest books (dev has an unpublished OLD "Impact One" duplicate
  // alongside the published canonical one), we can prefer the PUBLISHED book
  // - the canonical, reader-visible copy - instead of dropping the mapping.
  const destBookByTitle = new Map(); // bookTitle -> [{id, published}]
  const destLessonByTriple = new Map(); // book||unit||lesson -> [{id, published}]
  const seriesSnap = await dst.collection('librarySeries').get();
  for (const s of seriesSnap.docs) {
    if (IGNORE_SERIES.has(s.id)) { console.log(`  (ignoring series ${s.id} "${s.data().title}")`); continue; }
    const booksSnap = await s.ref.collection('books').get();
    for (const b of booksSnap.docs) {
      const bTitle = b.data().title;
      const published = b.data().published !== false; // missing == published (reader default)
      const bk = titleKey(bTitle);
      if (!destBookByTitle.has(bk)) destBookByTitle.set(bk, []);
      destBookByTitle.get(bk).push({ id: b.id, published });
      const unitsSnap = await b.ref.collection('units').get();
      for (const u of unitsSnap.docs) {
        const uTitle = u.data().title;
        const lessonsSnap = await u.ref.collection('lessons').get();
        for (const l of lessonsSnap.docs) {
          const key = titleKey(bTitle, uTitle, l.data().title);
          if (!destLessonByTriple.has(key)) destLessonByTriple.set(key, []);
          destLessonByTriple.get(key).push({ id: l.id, published });
        }
      }
    }
  }
  // Resolve a candidate list to a single id: unique -> it; multiple ->
  // the published one IF exactly one candidate is published; else ambiguous.
  function resolve(cands) {
    if (!cands || cands.length === 0) return { status: 'none' };
    if (cands.length === 1) return { status: 'ok', id: cands[0].id };
    const pub = cands.filter((c) => c.published);
    if (pub.length === 1) return { status: 'ok', id: pub[0].id };
    return { status: 'ambiguous' };
  }
  const destBookIdByTitle = new Map();
  for (const [k, v] of destBookByTitle) destBookIdByTitle.set(k, v);
  const destLessonIdByTriple = new Map();
  for (const [k, v] of destLessonByTriple) destLessonIdByTriple.set(k, v);
  console.log(`Dest nested content: ${destBookByTitle.size} distinct book titles, ${destLessonByTriple.size} distinct lesson triples.\n`);

  // Map an OLD source book id -> new dest book id (via title), or null.
  function mapOldBookId(oldId) {
    const r = resolve(destBookByTitle.get(titleKey(sBooks.get(oldId)?.title)));
    return r.status === 'ok' ? r.id : null;
  }

  // ---- Map users: access = union of licenses + digital-book purchases ----
  let okLic = 0, ambLic = 0, missLic = 0;
  const mappedUsers = [];
  const keptEmails = new Set();
  let skippedNoAccess = 0;
  for (const u of users) {
    const email = (u.email || '').trim().toLowerCase();
    if (!email) { skippedNoAccess++; continue; }
    const byNewId = new Map(); // newBookId -> license entry
    // 1) licenses from impact-users
    for (const lic of u.bookLicenses || []) {
      const newId = mapOldBookId(lic.bookId);
      if (!newId) {
        if ((destBookByTitle.get(titleKey(sBooks.get(lic.bookId)?.title)) || []).length > 1) ambLic++; else missLic++;
        continue;
      }
      okLic++;
      // No `source` field: a missing source means purchase-origin by the
      // model's own convention (none=purchase | group-license | admin-grant).
      // These legacy licenses were bought books, so that's faithful, and it
      // avoids implying a link to a specific NEW store-purchase doc that
      // doesn't exist.
      if (!byNewId.has(newId)) byNewId.set(newId, stripUndefined({
        bookId: newId, language: lic.language, type: lic.type,
        length: lic.length, purchaseDate: toMillis(lic.purchaseDate, undefined),
      }));
    }
    // 2) access from purchase history (books they paid for but with no license row)
    for (const [oldBookId, when] of purByEmail.get(email) || []) {
      const newId = mapOldBookId(oldBookId);
      if (!newId) continue;
      if (!byNewId.has(newId)) byNewId.set(newId, stripUndefined({
        bookId: newId, purchaseDate: when,
      }));
    }
    const remapped = [...byNewId.values()];
    // Skip users who never had any book access (no license, no purchase) -
    // per direction: they re-register fresh when they return. Verified none
    // of them have submissions, so nothing is lost.
    if (remapped.length === 0) { skippedNoAccess++; continue; }
    keptEmails.add(email);
    mappedUsers.push({ email, data: stripUndefined({
      email,
      firstName: (u.firstName || '').trim() || undefined,
      lastName: (u.lastName || '').trim() || undefined,
      phone: u.phone?.number || undefined,
      bookLicenses: remapped,
      licensedBookIds: [...byNewId.keys()],
      legacyId: u._id,
      legacyImport: true,
    }) });
  }
  console.log('--- User access mapping (licenses + purchases) ---');
  console.log(`  KEEP (>=1 book): ${mappedUsers.length} | SKIP (no access): ${skippedNoAccess} | of ${users.length} source users`);
  console.log(`  license rows: clean ${okLic}, ambiguous ${ambLic}, unmatched ${missLic}`);

  // ---- Map submissions (old lesson -> triple -> new lesson) ----
  let missSrc = 0, noMatch = 0, amb = 0, skippedOwner = 0;
  const mappedSubs = [];
  for (const s of submissions) {
    const email = (s.user || '').trim().toLowerCase();
    // Only migrate submissions for users we're keeping (all 121 belong to
    // kept users; this guard just keeps the two sets consistent).
    if (!keptEmails.has(email)) { skippedOwner++; continue; }
    const sl = sLessons.get(s.lesson);
    if (!sl) { missSrc++; continue; }
    const su = sUnits.get(sl.unit);
    const sb = su ? sBooks.get(su.book) : undefined;
    const r = resolve(destLessonByTriple.get(titleKey(sb?.title, su?.title, sl.title)));
    if (r.status === 'none') { noMatch++; continue; }
    if (r.status === 'ambiguous') { amb++; continue; }
    mappedSubs.push({ email, destLessonId: r.id, lessonTitle: sl.title, data: s.data || {}, date: s.date });
  }
  console.log('--- Submission lesson mapping ---');
  console.log(`  submissions ${submissions.length} | not-a-kept-user ${skippedOwner}, missing-source-lesson ${missSrc}, no-match ${noMatch}, ambiguous ${amb}, mapped ${mappedSubs.length}`);

  // Report any unmatched/ambiguous detail for review
  if (missLic || ambLic || noMatch || amb) {
    console.log('\n  (review the unmatched/ambiguous above before a live run)');
  }
  console.log('\n--- Sample users (first 5) ---');
  for (const m of mappedUsers.slice(0, 5)) console.log(`  ${m.email}: ${m.data.licensedBookIds.length} book(s)`);

  if (ANALYZE_ONLY || DRY_RUN) {
    console.log(`\n${ANALYZE_ONLY ? 'Analyze' : 'Dry run'} complete. No writes made.`);
    process.exit(0);
  }

  // ---- LIVE writes ----
  let uWritten = 0;
  for (const m of mappedUsers) {
    await dst.collection('libraryUsers').doc(m.email).set(m.data, { merge: true });
    uWritten++;
  }
  console.log(`\nWrote/merged ${uWritten} libraryUsers docs.`);

  let sWritten = 0, sSkipped = 0;
  for (const m of mappedSubs) {
    if (!m.email) continue;
    const ref = dst.collection('libraryUsers').doc(m.email).collection('submissions').doc(m.destLessonId);
    const existing = await ref.get();
    if (existing.exists) { sSkipped++; continue; }
    const createdAt = toMillis(m.date, Date.now());
    await ref.set({ lessonId: m.destLessonId, userId: '', data: m.data, createdAt, updatedAt: createdAt, legacyImport: true });
    sWritten++;
  }
  console.log(`Wrote ${sWritten} submissions, skipped ${sSkipped} pre-existing.`);
  console.log('\nLive migration complete.');
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
