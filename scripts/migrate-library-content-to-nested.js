#!/usr/bin/env node
// Phase 3 (consolidation plan) step 1: copies the Library content hierarchy
// - series -> books -> units -> lessons -> translations - out of the named
// 'impactdiscipleship-books' database (shared with the standalone manager
// app and the reader app) into THIS project's own (default) database, in
// the new nested-subcollection shape the plan already decided on:
//
//   librarySeries/{seriesId}
//     /books/{bookId}
//       /units/{unitId}
//         /lessons/{lessonId}
//           /translations/{translationId}
//
// Named `librarySeries`, not `series` - this project's own (default)
// database already has an unrelated top-level `series` collection (Store
// Manager's Product Series feature, store-manager/product-series/) that a
// bare `series` collection here would silently collide with. Nothing else
// in this hierarchy collides (checked against every existing top-level
// collection name in this app before writing this script).
//
// Deliberately scoped to ONLY the content hierarchy for this first pass -
// titleTranslations, subtemplates, lessonTemplates, commonTranslations,
// libraryUsers, purchases, groupLicenses/Invites, discussionGroups,
// activityLog, lessonImages, and bulkDiscountTiers are NOT touched here;
// they don't need restructuring (no parent-id-reference fields to fold into
// a nesting path) and can move as a flat, lower-risk follow-up.
//
// The old flat parent-id-reference fields (seriesId on books, bookId on
// units, unitId/bookId on lessons) are DROPPED on write - the new schema's
// nesting path IS the parent reference, per the plan's own "replacing
// today's flat collections + parent-id-reference fields" decision. Every
// other field carries over unchanged. Document ids are preserved exactly
// (setDoc, not addDoc) - they were already opaque/auto-generated (or, for
// AI-imported content, an existing deterministic scheme), satisfying the
// plan's "stable, opaque IDs" requirement with no regeneration needed.
//
// Dry-run by default - reports counts without writing anything. Pass
// --execute to actually write. --project=dev|prod is required, no default.
// Safe to re-run: every write is a full setDoc keyed by the source doc's
// own id, so a re-run just overwrites with the same (or updated-at-source)
// content rather than duplicating anything.
//
// Usage:
//   node scripts/migrate-library-content-to-nested.js --project=dev
//   node scripts/migrate-library-content-to-nested.js --project=dev --execute

const {resolveProjectId, getFirestoreFor} = require("./lib/firestore-admin");

const NAMED_DB = "impactdiscipleship-books";
const CHUNK_SIZE = 400;

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const eq = raw.indexOf("=");
    if (eq === -1) args[raw.slice(2)] = true;
    else args[raw.slice(2, eq)] = raw.slice(eq + 1);
  }
  return args;
}

/**
 * Copies every doc in `snap` into `targetCollectionRef`, same id, with
 * `dropFields` stripped from the data - queued into `writer` rather than
 * written immediately, so the caller controls batching/commit timing.
 * @param {FirebaseFirestore.QuerySnapshot} snap Source docs to copy.
 * @param {FirebaseFirestore.CollectionReference} targetCollectionRef Where
 * to write them.
 * @param {string[]} dropFields Field names to omit from the copied data.
 * @param {Array<{ref: FirebaseFirestore.DocumentReference, data: object}>} writes
 * Accumulator this function appends to.
 */
function queueCopies(snap, targetCollectionRef, dropFields, writes) {
  for (const doc of snap.docs) {
    const data = {...doc.data()};
    for (const field of dropFields) {
      delete data[field];
    }
    writes.push({ref: targetCollectionRef.doc(doc.id), data});
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const execute = !!args.execute;

  const sourceDb = getFirestoreFor(projectId, NAMED_DB);
  const targetDb = getFirestoreFor(projectId);

  console.log(`Project: ${projectId}`);
  console.log(`Mode: ${execute ? "EXECUTE (will write)" : "DRY RUN (no writes)"}`);
  console.log("");

  const writes = [];
  let seriesCount = 0;
  let bookCount = 0;
  let unitCount = 0;
  let lessonCount = 0;
  let translationCount = 0;

  const seriesSnap = await sourceDb.collection("series").get();
  for (const seriesDoc of seriesSnap.docs) {
    seriesCount++;
    const seriesTargetRef = targetDb.collection("librarySeries").doc(seriesDoc.id);
    writes.push({ref: seriesTargetRef, data: {...seriesDoc.data()}});

    const booksSnap = await sourceDb
      .collection("books")
      .where("seriesId", "==", seriesDoc.id)
      .get();
    const booksTargetRef = seriesTargetRef.collection("books");
    queueCopies(booksSnap, booksTargetRef, ["seriesId"], writes);
    bookCount += booksSnap.size;

    for (const bookDoc of booksSnap.docs) {
      const bookTargetRef = booksTargetRef.doc(bookDoc.id);
      const unitsSnap = await sourceDb
        .collection("units")
        .where("bookId", "==", bookDoc.id)
        .get();
      const unitsTargetRef = bookTargetRef.collection("units");
      queueCopies(unitsSnap, unitsTargetRef, ["bookId"], writes);
      unitCount += unitsSnap.size;

      for (const unitDoc of unitsSnap.docs) {
        const unitTargetRef = unitsTargetRef.doc(unitDoc.id);
        const lessonsSnap = await sourceDb
          .collection("lessons")
          .where("unitId", "==", unitDoc.id)
          .get();
        const lessonsTargetRef = unitTargetRef.collection("lessons");
        queueCopies(lessonsSnap, lessonsTargetRef, ["unitId", "bookId"], writes);
        lessonCount += lessonsSnap.size;

        for (const lessonDoc of lessonsSnap.docs) {
          const lessonTargetRef = lessonsTargetRef.doc(lessonDoc.id);
          const translationsSnap = await sourceDb
            .collection("lessons")
            .doc(lessonDoc.id)
            .collection("translations")
            .get();
          const translationsTargetRef = lessonTargetRef.collection("translations");
          queueCopies(translationsSnap, translationsTargetRef, ["lessonId"], writes);
          translationCount += translationsSnap.size;
        }
      }
    }
  }

  console.log("Source counts:");
  console.log(`  series:       ${seriesCount}`);
  console.log(`  books:        ${bookCount}`);
  console.log(`  units:        ${unitCount}`);
  console.log(`  lessons:      ${lessonCount}`);
  console.log(`  translations: ${translationCount}`);
  console.log(`  TOTAL docs:   ${writes.length}`);
  console.log("");

  if (!execute) {
    console.log("Dry run - nothing written. Re-run with --execute to write.");
    return;
  }

  for (let i = 0; i < writes.length; i += CHUNK_SIZE) {
    const chunk = writes.slice(i, i + CHUNK_SIZE);
    const batch = targetDb.batch();
    for (const {ref, data} of chunk) {
      batch.set(ref, data);
    }
    await batch.commit();
    console.log(`Wrote ${Math.min(i + CHUNK_SIZE, writes.length)}/${writes.length} docs...`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
