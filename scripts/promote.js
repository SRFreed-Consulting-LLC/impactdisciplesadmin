#!/usr/bin/env node
// Promotes Dev's validated/fixed data back to Prod. Direction is fixed -
// reads live impactdisciplesdev, writes live impactdisciples-a82a8 -
// deliberately not configurable via a --target flag, this tool only ever
// goes one way.
//
// Scope: defaults to whatever collections currently exist in PROD (not
// Dev), minus DEFAULT_SKIP. This is deliberate, not an oversight - Dev has
// brand-new collections (admin_users, subscriptions, forms,
// form_submissions, cards, pages, ...) that don't exist in Prod yet because
// their code hasn't been deployed there or their own migration hasn't run
// yet (see MIGRATION.md / the admin_users and subscriptions cutover
// discussions). Anchoring scope to Prod's own current schema means those
// stay out of scope automatically, without needing to hand-maintain a
// skip-list entry for every new Dev-only collection that shows up over
// time. Use --only to promote something outside that scope on purpose,
// once you're actually ready for it.
//
// Conflict rule: a doc that exists in Dev but not Prod is new - promoted
// as-is. A doc that exists in both with identical data (ignoring the
// bookkeeping fields below) is a no-op. A doc that exists in both with
// DIFFERENT data is a real conflict - surfaced in the dry-run diff, and
// never auto-written even with --execute unless --force-conflicts is
// passed (doc-by-doc review is expected first).
//
// Bookkeeping fields added by import.js / Dev's own new-record-alert and
// purchase-fulfillment Cloud Function triggers are stripped before writing
// to Prod and before conflict comparison - they describe Dev's own
// import/notification-bell state, not real business data Prod should have.
//
// firebaseUID and paypalClientId are stripped too, via the shared
// lib/protected-fields.js list - fields that must never cross the Prod<->Dev
// boundary in either direction because each environment has its own real
// value (firebaseUID: separate Auth pools, confirmed earlier for
// admin_users; paypalClientId: sandbox vs live, live-diagnosed 2026-08-12
// after an import overwrote Dev's sandbox id with Prod's live one).
//
// Usage:
//   node scripts/promote.js                          # dry run, default scope
//   node scripts/promote.js --execute                # write new docs to Prod
//   node scripts/promote.js --only=purchases,events --execute
//   node scripts/promote.js --execute --force-conflicts   # also overwrite conflicts

const {getFirestoreFor} = require("./lib/firestore-admin");
const {toPortable} = require("./lib/firestore-json");
const {deepEqual: structuralEqual} = require("./lib/deep-equal");
const {NEVER_OVERWRITE_FIELDS} = require("./lib/protected-fields");

const IGNORED_FIELDS = ["_dataOps", "newRecordStatus", "fulfillmentStatus", ...NEVER_OVERWRITE_FIELDS];

const DEFAULT_SKIP = new Set([
  "mail",
  "notification_registrations",
  "log-messages",
  "meta",
  "users",
  "newsletter_subscriptions",
  "prayer_team_subscriptions",
  "consultation_requests",
  "consultation_surveys",
  "lunch_and_learns",
  "seminars",
  "blog_categories",
  "blog_posts",
  // event-announcements was wrongly here at one point - it's a live feature
  // (EventAnnouncementService, the Announcements tab under Events),
  // confirmed via an actual code-usage audit on 2026-08-11.
  // Belt-and-suspenders - these shouldn't appear in Prod's own collection
  // list yet anyway (see header comment), but listed explicitly in case
  // that ever changes out from under this default.
  "admin_users",
  "subscriptions",
  "forms",
  "form_submissions",
]);

/**
 * Parses simple --key=value / --flag CLI arguments.
 * @param {string[]} argv process.argv.slice(2).
 * @return {Object<string,string|boolean>} Parsed args.
 */
function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const eq = raw.indexOf("=");
    if (eq === -1) {
      args[raw.slice(2)] = true;
    } else {
      args[raw.slice(2, eq)] = raw.slice(eq + 1);
    }
  }
  return args;
}

/**
 * Strips Dev-only bookkeeping fields before writing to Prod or comparing
 * for conflicts.
 * @param {Object} data Raw document data.
 * @return {Object} A new object with IGNORED_FIELDS removed.
 */
function stripIgnored(data) {
  const out = {...data};
  for (const f of IGNORED_FIELDS) delete out[f];
  return out;
}

/**
 * Structural equality after normalizing Timestamp/GeoPoint/DocumentReference
 * on both sides via toPortable() - and comparing object keys order-
 * independently (see lib/deep-equal.js; a naive JSON.stringify comparison
 * treats two objects with the same keys in different insertion order as
 * different, which is NOT a real conflict).
 * @param {Object} a First doc data (already stripIgnored'd).
 * @param {Object} b Second doc data (already stripIgnored'd).
 * @return {boolean} Whether they're equivalent.
 */
function deepEqual(a, b) {
  return structuralEqual(toPortable(a), toPortable(b));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const execute = !!args.execute;
  const forceConflicts = !!args["force-conflicts"];

  const devDb = getFirestoreFor("impactdisciplesdev");
  const prodDb = getFirestoreFor("impactdisciples-a82a8");

  let collectionNames;
  if (args.only) {
    collectionNames = String(args.only).split(",").map((s) => s.trim());
  } else {
    const prodCollections = (await prodDb.listCollections()).map((c) => c.id);
    const extraSkip = args.skip ?
      String(args.skip).split(",").map((s) => s.trim()) :
      [];
    const skipSet = new Set([...DEFAULT_SKIP, ...extraSkip]);
    collectionNames = prodCollections.filter((c) => !skipSet.has(c)).sort();
  }

  console.log(`${execute ? "LIVE RUN" : "DRY RUN"}: promote Dev -> Prod`);
  console.log(`  Collections (${collectionNames.length}): ${collectionNames.join(", ")}`);
  if (execute && forceConflicts) {
    console.log("  --force-conflicts set: differing docs WILL be overwritten in Prod");
  }
  console.log("");

  const totals = {new: 0, unchanged: 0, conflict: 0};
  const conflictDetails = [];

  for (const name of collectionNames) {
    const devSnap = await devDb.collection(name).get();
    const devDocs = devSnap.docs;

    // Fetch the corresponding Prod docs (if any) via chunked getAll(), far
    // cheaper than one .get() per doc.
    const prodDataById = new Map();
    const CHUNK = 300;
    for (let i = 0; i < devDocs.length; i += CHUNK) {
      const chunkRefs = devDocs
        .slice(i, i + CHUNK)
        .map((d) => prodDb.collection(name).doc(d.id));
      if (chunkRefs.length === 0) continue;
      const snaps = await prodDb.getAll(...chunkRefs);
      snaps.forEach((s) => {
        if (s.exists) prodDataById.set(s.id, s.data());
      });
    }

    let newCount = 0;
    let unchangedCount = 0;
    let conflictCount = 0;
    let batch = prodDb.batch();
    let opsInBatch = 0;

    for (const doc of devDocs) {
      const devData = stripIgnored(doc.data());
      const hasProd = prodDataById.has(doc.id);
      const prodData = hasProd ? stripIgnored(prodDataById.get(doc.id)) : undefined;

      let shouldWrite = false;
      if (!hasProd) {
        newCount++;
        shouldWrite = true;
      } else if (deepEqual(devData, prodData)) {
        unchangedCount++;
      } else {
        conflictCount++;
        conflictDetails.push({collection: name, id: doc.id});
        shouldWrite = forceConflicts;
      }

      if (execute && shouldWrite) {
        batch.set(prodDb.collection(name).doc(doc.id), devData, {merge: true});
        opsInBatch++;
        if (opsInBatch >= 400) {
          await batch.commit();
          batch = prodDb.batch();
          opsInBatch = 0;
        }
      }
    }
    if (execute && opsInBatch > 0) {
      await batch.commit();
    }

    totals.new += newCount;
    totals.unchanged += unchangedCount;
    totals.conflict += conflictCount;

    if (newCount || conflictCount) {
      console.log(
        `  ${name}: ${newCount} new, ${unchangedCount} unchanged, ${conflictCount} conflict(s)`
      );
    }
  }

  console.log("");
  console.log(
    `Totals: ${totals.new} new, ${totals.unchanged} unchanged, ${totals.conflict} conflict(s)`
  );

  if (conflictDetails.length) {
    const status = forceConflicts ?
      "(--force-conflicts set - these WERE overwritten in Prod)" :
      "(left untouched in Prod - review needed)";
    console.log(`\n${conflictDetails.length} conflict(s) ${status}:`);
    conflictDetails.slice(0, 20).forEach((c) => console.log(`  - ${c.collection}/${c.id}`));
    if (conflictDetails.length > 20) {
      console.log(`  ... and ${conflictDetails.length - 20} more`);
    }
  }

  console.log("");
  if (!execute) {
    console.log("Dry run only - review the above, then re-run with --execute to write.");
  } else {
    console.log("Done - new docs written to impactdisciples-a82a8.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
