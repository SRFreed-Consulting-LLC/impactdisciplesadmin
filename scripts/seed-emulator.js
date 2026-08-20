// Seeds the Firebase Emulator Suite with the deterministic fixture world in
// scripts/fixtures/emulator-fixtures.js. EMULATOR-ONLY by construction: it
// forces the emulator host env vars and the demo-impact project id before
// touching the Admin SDK, so it cannot write to impactdisciplesdev or prod
// no matter what credentials the machine has.
//
// Idempotent via wipe-first: every run clears the Firestore database and
// Auth accounts through the emulators' REST wipe endpoints, then reseeds -
// so a second run (or a between-suite reset) always lands on the identical
// world. Run while `npm run emu` is up:
//
//   node scripts/seed-emulator.js
//
// If the Functions emulator is also running, seeding fires the real
// Firestore triggers (session-count reconciliation, customer upserts,
// new-record alerts) - that's intended; the post-trigger world is the
// realistic one. Suites that need trigger-free data should write their own
// docs after a wipe instead.

process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST || "localhost:9099";

const PROJECT_ID = "demo-impact";

const path = require("path");
const functionsDir = path.join(__dirname, "..", "functions");
const admin = require(require.resolve("firebase-admin", {paths: [functionsDir]}));
const {getFirestore, Timestamp} = require(
  require.resolve("firebase-admin/firestore", {paths: [functionsDir]})
);
const fixtures = require("./fixtures/emulator-fixtures");

const app = admin.initializeApp({projectId: PROJECT_ID}, "seed-emulator");
const db = getFirestore(app);
db.settings({ignoreUndefinedProperties: true});

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

// Collections whose dates must stay ISO STRINGS: the web store's
// active-sale filter does `new Date(sale.startDate as string)` directly
// (product-catalog.service.ts), matching how the admin Sales screen
// actually stores them - a Timestamp there would parse as Invalid Date and
// silently disable every sale.
const STRING_DATE_COLLECTIONS = new Set(["sales"]);

// Fixtures carry dates as ISO strings; real data carries Timestamps (and
// range queries/sorts depend on that - see MIGRATION.md). Convert every
// ISO-shaped string, recursively.
function withTimestamps(value) {
  if (typeof value === "string" && ISO_RE.test(value)) {
    return Timestamp.fromDate(new Date(value));
  }
  if (Array.isArray(value)) return value.map(withTimestamps);
  if (value && typeof value === "object" && value.constructor === Object) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = withTimestamps(v);
    return out;
  }
  return value;
}

async function wipe() {
  const wipeFirestore = fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/` +
      `${PROJECT_ID}/databases/(default)/documents`,
    {method: "DELETE"}
  );
  const wipeAuth = fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/` +
      `${PROJECT_ID}/accounts`,
    {method: "DELETE"}
  );
  const [fsRes, authRes] = await Promise.all([wipeFirestore, wipeAuth]);
  if (!fsRes.ok) throw new Error(`Firestore wipe failed: ${fsRes.status}`);
  if (!authRes.ok) throw new Error(`Auth wipe failed: ${authRes.status}`);
  console.log("Wiped emulator Firestore + Auth.");
}

async function seedAuth() {
  for (const user of fixtures.AUTH_USERS) {
    await admin.auth(app).createUser(user);
  }
  console.log(`Created ${fixtures.AUTH_USERS.length} Auth users.`);
}

async function seedCollections() {
  let count = 0;
  let batch = db.batch();
  let inBatch = 0;
  const commitIfFull = async () => {
    if (inBatch >= 400) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
    }
  };
  for (const [collection, docs] of Object.entries(fixtures.collections)) {
    const keepStrings = STRING_DATE_COLLECTIONS.has(collection);
    for (const [id, data] of Object.entries(docs)) {
      batch.set(db.collection(collection).doc(id), keepStrings ? data : withTimestamps(data));
      count++; inBatch++;
      await commitIfFull();
    }
  }
  // Library content is a nested tree: librarySeries/{s}/books/{b}/units/{u}/lessons/{l}
  for (const [seriesId, series] of Object.entries(fixtures.librarySeriesTree)) {
    const seriesRef = db.collection("librarySeries").doc(seriesId);
    batch.set(seriesRef, withTimestamps(series.doc));
    count++; inBatch++; await commitIfFull();
    for (const [bookId, book] of Object.entries(series.books)) {
      const bookRef = seriesRef.collection("books").doc(bookId);
      batch.set(bookRef, withTimestamps(book.doc));
      count++; inBatch++; await commitIfFull();
      for (const [unitId, unit] of Object.entries(book.units || {})) {
        const unitRef = bookRef.collection("units").doc(unitId);
        batch.set(unitRef, withTimestamps(unit.doc));
        count++; inBatch++; await commitIfFull();
        for (const [lessonId, lesson] of Object.entries(unit.lessons || {})) {
          batch.set(unitRef.collection("lessons").doc(lessonId), withTimestamps(lesson.doc));
          count++; inBatch++; await commitIfFull();
        }
      }
    }
  }
  await batch.commit();
  console.log(`Seeded ${count} documents.`);
}

// The Functions emulator fires Firestore triggers for EVERY write this
// script makes - including the wipe's deletes of the previous world. That
// backlog drains slowly and interleaves unpredictably, so after seeding we
// (1) wait for trigger quiescence (no observable side-effect changes for a
// quiet window), then (2) overwrite the session-count meta docs with truth
// computed straight from the fixtures - making the post-seed world exactly
// deterministic no matter what the wipe's delete-triggers did to the
// increments in the meantime.
async function settleTriggerBacklog() {
  const signature = async () => {
    const [counts, customers, mail] = await Promise.all([
      db.collection("eventSessionCounts").get(),
      db.collection("customers").count().get(),
      db.collection("mail").count().get(),
    ]);
    return JSON.stringify({
      counts: counts.docs.map((d) => [d.id, d.data().counts]),
      customers: customers.data().count,
      mail: mail.data().count,
    });
  };
  let previous = await signature();
  let quietPolls = 0;
  const deadline = Date.now() + 180000;
  while (quietPolls < 5) {
    if (Date.now() > deadline) {
      throw new Error("Trigger backlog never went quiet (180s)");
    }
    await new Promise((r) => setTimeout(r, 2000));
    const current = await signature();
    quietPolls = current === previous ? quietPolls + 1 : 0;
    previous = current;
  }
}

async function writeSessionCountTruth() {
  // Recompute per-event session counts straight from the registration
  // fixtures (same rule as the trigger: unique string session ids per doc).
  const byEvent = {};
  const regs = fixtures.collections["event-registrations"];
  for (const reg of Object.values(regs)) {
    const counts = (byEvent[reg.eventId] = byEvent[reg.eventId] ?? {});
    for (const s of new Set(reg.trainingSessions ?? [])) {
      counts[s] = (counts[s] ?? 0) + 1;
    }
  }
  for (const [eventId, counts] of Object.entries(byEvent)) {
    await db.collection("eventSessionCounts").doc(eventId).set({
      counts, seeded: true, updatedAt: Timestamp.fromDate(new Date()),
    });
  }
}

(async () => {
  await wipe();
  await seedAuth();
  await seedCollections();
  console.log("Waiting for the trigger backlog to go quiet...");
  await settleTriggerBacklog();
  await writeSessionCountTruth();
  console.log("Emulator seed complete (project demo-impact).");
  process.exit(0);
})().catch((e) => {
  console.error("SEED FAILED:", e.message);
  process.exit(1);
});
