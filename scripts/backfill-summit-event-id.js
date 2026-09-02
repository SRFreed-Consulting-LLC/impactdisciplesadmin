#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// One-time (idempotent) repair: repoint every reference to the RETIRED
// Disciple-Making Summit event id at the live one.
//
// WHAT HAPPENED. A Firestore document id cannot be renamed, so changing it
// means delete-and-recreate. When the Summit event was recreated it picked
// up two stray characters: `wmIs6PJtE7hNGnm15T8a` (20 chars, a real auto-id)
// became `wmIs6PJtE7hNGnm15T8222` (22). The event-registrations were
// repointed at the time - 731 carry the new id and none carry the old - but
// nothing else was, leaving 515 dangling references.
//
// WHY THE NEW ID WINS, ugly as it is: it is the id the live event document
// actually has, and the one 731 registrations already reference. Recreating
// the event under the original id would mean rewriting far more than this.
//
// SCOPE. Verified by walking every document in every collection: 515
// occurrences across 515 documents, exactly one each -
//
//   purchases            510   cartItems[].id on historical Summit orders
//   coupons                3   tags[].id targeting the event
//   email_lists            1   type: "attendees_<eventId>"
//   event-announcements    1   eventId
//
// Dry-run by default. Pass --execute to write.
//
//   node scripts/backfill-summit-event-id.js --project=prod [--execute]

const { resolveProjectId, getFirestoreFor, firestore } = require("./lib/firestore-admin");

const OLD_ID = "wmIs6PJtE7hNGnm15T8a";
const NEW_ID = "wmIs6PJtE7hNGnm15T8222";

// The old id is a strict PREFIX of the new one, so a naive replace would
// turn an ALREADY-CORRECT "wmIs6PJtE7hNGnm15T8222" into that plus "22".
// Matching the old id only when NOT followed by the two extra characters is
// what makes this script safe to re-run.
const OLD_NOT_NEW = new RegExp(`${OLD_ID}(?!22)`, "g");

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}`));
  if (!hit) return undefined;
  const [, value] = hit.split("=");
  return value === undefined ? true : value;
};

// NEVER round-trip document data through JSON to do this. JSON.stringify
// turns a Firestore Timestamp into a plain {_seconds, _nanoseconds} object,
// and writing that back stores a MAP where a Timestamp used to be. That is a
// real, already-present defect in this database (~28% of cartItems carry
// dates in exactly that broken shape) and doing it to 510 purchase documents
// would be a self-inflicted repeat of it. So: walk the structure, touch only
// strings, and hand every Firestore-native value straight back.
const isNative = (v) =>
  v instanceof firestore.Timestamp ||
  (firestore.GeoPoint && v instanceof firestore.GeoPoint) ||
  (firestore.DocumentReference && v instanceof firestore.DocumentReference) ||
  Buffer.isBuffer(v) ||
  v instanceof Date;

/** Counts occurrences of the retired id in a value, recursively. */
function countOld(value) {
  if (typeof value === "string") {
    OLD_NOT_NEW.lastIndex = 0;
    return (value.match(OLD_NOT_NEW) || []).length;
  }
  if (Array.isArray(value)) return value.reduce((n, v) => n + countOld(v), 0);
  if (value === null || typeof value !== "object" || isNative(value)) return 0;
  return Object.values(value).reduce((n, v) => n + countOld(v), 0);
}

/** Returns a copy with the retired id replaced in every string. */
function deepReplace(value) {
  if (typeof value === "string") {
    OLD_NOT_NEW.lastIndex = 0;
    return value.replace(OLD_NOT_NEW, NEW_ID);
  }
  if (Array.isArray(value)) return value.map(deepReplace);
  if (value === null || typeof value !== "object" || isNative(value)) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = deepReplace(v);
  return out;
}

(async () => {
  const project = arg("project");
  if (!project) {
    console.error("Usage: node scripts/backfill-summit-event-id.js --project=dev|prod [--execute]");
    process.exit(1);
  }
  const execute = !!arg("execute");
  const db = getFirestoreFor(resolveProjectId(project));

  // Confirm the destination exists before repointing anything at it.
  const target = await tenantCollection(db, "events").doc(NEW_ID).get();
  if (!target.exists) {
    console.error(`ABORT: events/${NEW_ID} does not exist in this project.`);
    process.exit(1);
  }
  console.log(`target: events/${NEW_ID} "${target.get("eventName")}"`);

  const collections = await db.listCollections();
  const plan = [];
  for (const col of collections) {
    const snap = await col.get();
    snap.forEach((doc) => {
      const n = countOld(doc.data());
      if (n) plan.push({ ref: doc.ref, path: doc.ref.path, collection: col.id, occurrences: n });
    });
  }

  const byCollection = plan.reduce((acc, p) => {
    acc[p.collection] = (acc[p.collection] || 0) + 1;
    return acc;
  }, {});
  const total = plan.reduce((n, p) => n + p.occurrences, 0);
  console.log(`\n${plan.length} document(s), ${total} occurrence(s):`);
  Object.entries(byCollection).forEach(([c, n]) => console.log(`   ${c}: ${n}`));

  if (!plan.length) {
    console.log("\nNothing to do - already repointed.");
    return;
  }
  if (!execute) {
    console.log("\n[dry-run] nothing written. Re-run with --execute to apply.");
    plan.slice(0, 5).forEach((p) => console.log(`   would rewrite ${p.path}`));
    if (plan.length > 5) console.log(`   ... and ${plan.length - 5} more`);
    return;
  }

  // Re-read inside the write loop rather than trusting the scan's snapshot:
  // scanning 24k documents takes a while, and a purchase written in the
  // meantime must not be clobbered with stale data.
  let written = 0;
  for (let i = 0; i < plan.length; i += 200) {
    const chunk = plan.slice(i, i + 200);
    const batch = db.batch();
    let staged = 0;
    for (const item of chunk) {
      const fresh = await item.ref.get();
      if (!fresh.exists) continue;
      const data = fresh.data();
      if (!countOld(data)) continue;
      batch.set(item.ref, deepReplace(data));
      staged++;
    }
    if (staged) await batch.commit();
    written += staged;
    console.log(`   committed ${written}/${plan.length}`);
  }
  console.log(`\nrepointed ${written} document(s) from ${OLD_ID} to ${NEW_ID}`);
})().catch((e) => { console.error(e); process.exit(1); });
