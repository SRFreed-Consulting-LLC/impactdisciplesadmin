#!/usr/bin/env node
// Phase 3 (consolidation plan) follow-up to migrate-library-content-to-
// nested.js and migrate-library-flat-collections.js: copies the
// reader-app-OWNED collections (this app only reads/administers them, the
// reader app is the real writer) out of the named 'impactdiscipleship-
// books' database into this project's own (default) database, under the
// SAME collection names/paths. Straight copy, not a schema change - every
// path here keeps its existing shape, including the subcollections that
// live under a parent doc rather than as separate top-level collections.
//
// Scope, per explicit instruction ("do the reader owned data collections"):
//   libraryUsers/{email}
//     /messages/{id}          (admin-announcement inbox copies)
//     /lessonStatus/{id}
//     /lessonHighlights/{id}
//
// Deliberately excludes /fcmTokens/{token} - device push tokens re-register
// automatically the next time each app instance launches, so there's
// nothing worth preserving there (and a stale copied token pointing at a
// device that's since re-registered fresh would just be dead weight).
//   groupLicenses/{licenseId}
//   groupInvites/{inviteId}
//   discussionGroups/{groupId}
//     /members/{email}
//     /chatMessages/{id}
//     /prayerRequests/{id}
//     /conversations/{email}/messages/{id}   (double-nested)
//   submissions/{lessonId}_{email}           (top-level, NOT nested under
//                                             libraryUsers - confirmed via
//                                             the reader app's own source)
//   adminMessages/{messageId}
//
// Deliberately EXCLUDES `purchases` - already decided (Phase 3 notes) to
// archive it for reference rather than migrate it live; it would also
// collide with this project's own native `purchases` collection (store
// orders). None of the collections actually copied here collide with
// anything existing.
//
// Dry-run by default - reports counts without writing anything. Pass
// --execute to actually write. --project=dev|prod is required, no default.
// Safe to re-run: every write is a full setDoc keyed by the source doc's
// own id, so a re-run just overwrites with the same (or updated-at-source)
// content rather than duplicating anything.
//
// Usage:
//   node scripts/migrate-library-reader-owned-collections.js --project=dev
//   node scripts/migrate-library-reader-owned-collections.js --project=dev --execute

const {resolveProjectId, getFirestoreFor} = require("./lib/firestore-admin");

const NAMED_DB = "impactdiscipleship-books";
const CHUNK_SIZE = 400;
const LIBRARY_USER_SUBCOLLECTIONS = ["messages", "lessonStatus", "lessonHighlights"];

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
 * Queues a straight copy of every doc in `snap` into `targetCollectionRef`,
 * same id, unchanged data.
 * @param {FirebaseFirestore.QuerySnapshot} snap Source docs to copy.
 * @param {FirebaseFirestore.CollectionReference} targetCollectionRef Where
 * to write them.
 * @param {Array<{ref: FirebaseFirestore.DocumentReference, data: object}>} writes
 * Accumulator this function appends to.
 * @return {void}
 */
function queueCopies(snap, targetCollectionRef, writes) {
  for (const doc of snap.docs) {
    writes.push({ref: targetCollectionRef.doc(doc.id), data: doc.data()});
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
  const counts = {
    libraryUsers: 0,
    libraryUserSubcollections: 0,
    groupLicenses: 0,
    groupInvites: 0,
    discussionGroups: 0,
    members: 0,
    chatMessages: 0,
    prayerRequests: 0,
    conversationMessages: 0,
    submissions: 0,
    adminMessages: 0,
  };

  // libraryUsers + its 4 subcollections.
  const libraryUsersSnap = await sourceDb.collection("libraryUsers").get();
  counts.libraryUsers = libraryUsersSnap.size;
  const libraryUsersTargetRef = targetDb.collection("libraryUsers");
  queueCopies(libraryUsersSnap, libraryUsersTargetRef, writes);
  for (const userDoc of libraryUsersSnap.docs) {
    const userTargetRef = libraryUsersTargetRef.doc(userDoc.id);
    for (const sub of LIBRARY_USER_SUBCOLLECTIONS) {
      const subSnap = await userDoc.ref.collection(sub).get();
      counts.libraryUserSubcollections += subSnap.size;
      queueCopies(subSnap, userTargetRef.collection(sub), writes);
    }
  }

  // groupLicenses, groupInvites - flat, top-level.
  const groupLicensesSnap = await sourceDb.collection("groupLicenses").get();
  counts.groupLicenses = groupLicensesSnap.size;
  queueCopies(groupLicensesSnap, targetDb.collection("groupLicenses"), writes);

  const groupInvitesSnap = await sourceDb.collection("groupInvites").get();
  counts.groupInvites = groupInvitesSnap.size;
  queueCopies(groupInvitesSnap, targetDb.collection("groupInvites"), writes);

  // discussionGroups + its 4 subcollection types (conversations is
  // itself double-nested: conversations/{email}/messages/{id}).
  const groupsSnap = await sourceDb.collection("discussionGroups").get();
  counts.discussionGroups = groupsSnap.size;
  const groupsTargetRef = targetDb.collection("discussionGroups");
  queueCopies(groupsSnap, groupsTargetRef, writes);
  for (const groupDoc of groupsSnap.docs) {
    const groupTargetRef = groupsTargetRef.doc(groupDoc.id);

    const membersSnap = await groupDoc.ref.collection("members").get();
    counts.members += membersSnap.size;
    queueCopies(membersSnap, groupTargetRef.collection("members"), writes);

    const chatSnap = await groupDoc.ref.collection("chatMessages").get();
    counts.chatMessages += chatSnap.size;
    queueCopies(chatSnap, groupTargetRef.collection("chatMessages"), writes);

    const prayerSnap = await groupDoc.ref.collection("prayerRequests").get();
    counts.prayerRequests += prayerSnap.size;
    queueCopies(prayerSnap, groupTargetRef.collection("prayerRequests"), writes);

    const conversationsSnap = await groupDoc.ref.collection("conversations").get();
    const conversationsTargetRef = groupTargetRef.collection("conversations");
    queueCopies(conversationsSnap, conversationsTargetRef, writes);
    for (const conversationDoc of conversationsSnap.docs) {
      const messagesSnap = await conversationDoc.ref.collection("messages").get();
      counts.conversationMessages += messagesSnap.size;
      queueCopies(
        messagesSnap,
        conversationsTargetRef.doc(conversationDoc.id).collection("messages"),
        writes
      );
    }
  }

  // submissions - top-level, NOT nested under libraryUsers.
  const submissionsSnap = await sourceDb.collection("submissions").get();
  counts.submissions = submissionsSnap.size;
  queueCopies(submissionsSnap, targetDb.collection("submissions"), writes);

  // adminMessages - top-level.
  const adminMessagesSnap = await sourceDb.collection("adminMessages").get();
  counts.adminMessages = adminMessagesSnap.size;
  queueCopies(adminMessagesSnap, targetDb.collection("adminMessages"), writes);

  console.log("Source counts:");
  console.log(`  libraryUsers:               ${counts.libraryUsers}`);
  console.log(`  libraryUsers subcollections: ${counts.libraryUserSubcollections}`);
  console.log(`  groupLicenses:              ${counts.groupLicenses}`);
  console.log(`  groupInvites:               ${counts.groupInvites}`);
  console.log(`  discussionGroups:           ${counts.discussionGroups}`);
  console.log(`  members:                    ${counts.members}`);
  console.log(`  chatMessages:               ${counts.chatMessages}`);
  console.log(`  prayerRequests:             ${counts.prayerRequests}`);
  console.log(`  conversation messages:      ${counts.conversationMessages}`);
  console.log(`  submissions:                ${counts.submissions}`);
  console.log(`  adminMessages:              ${counts.adminMessages}`);
  console.log(`  TOTAL docs:                 ${writes.length}`);
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
