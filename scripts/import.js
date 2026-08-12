#!/usr/bin/env node
// Upserts a snapshot produced by export.js into a target project (normally
// impactdisciplesdev), merging into whatever's already there and
// normalizing the known bad date shapes along the way (see
// lib/normalize-dates.js). Every written doc is tagged under `_dataOps` so
// promoted-from-prod data stays distinguishable from organically-created
// Dev data later.
//
// Also pre-suppresses the "new" bell/dashboard indicator for old purchases
// (dateProcessed before 2026-08-01 - also marks fulfillmentStatus "closed"
// for physical-item purchases) and event-registrations tied to an event
// that's already started - see lib/suppress-new-status.js. Without this,
// reimporting years of Prod history into a freshly wiped Dev would flag
// literally all of it "new", which isn't useful to staff.
//
// Dry-run by default - reports what would happen without writing anything.
// Pass --execute to actually write.
//
// Usage:
//   node scripts/import.js --snapshot=scripts/backups/impactdisciples-a82a8-<ts> --project=dev
//   node scripts/import.js --snapshot=... --project=dev --execute
//   node scripts/import.js --snapshot=... --project=dev --only=purchases,events --execute
//
// Collections excluded by default (real, explicit decisions - see
// scripts/README.md for why each one is here, not just an oversight):
//   mail, notification_registrations  - real send history / live device
//     push tokens; re-triggering either against real people is the one
//     mistake this tool must never make by default
//   log-messages, meta                - ops log + a per-environment
//     aggregate counter, neither has "validate and promote" value
//   users, newsletter_subscriptions, prayer_team_subscriptions,
//   consultation_requests, consultation_surveys, lunch_and_learns,
//   seminars, blog_categories, blog_posts
//                                      - retired/superseded collections the
//     current code no longer has screens for; being deleted, not migrated
//
// event-announcements was wrongly in this list at one point - it's a live
// feature (EventAnnouncementService, the Announcements tab under Events),
// confirmed via an actual code-usage audit on 2026-08-11. Don't re-add it
// without checking usage again first.
//
// Pass --only=<list> to override this entirely (whitelist only, ignores the
// default skip list) or --skip=<list> to add MORE exclusions on top of the
// defaults - there's no flag to shrink the default skip list, that's a
// deliberate floor, not a default.

const fs = require("fs");
const path = require("path");
const {resolveProjectId, getFirestoreFor, admin} = require("./lib/firestore-admin");
const {fromPortable} = require("./lib/firestore-json");
const {normalizeDoc} = require("./lib/normalize-dates");
const {
  toDate,
  suppressOldPurchase,
  suppressPastEventRegistration,
} = require("./lib/suppress-new-status");
const {stripProtectedFields} = require("./lib/protected-fields");

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
 * Resolves and sanity-checks a --snapshot=<path> argument.
 * @param {string} value Raw --snapshot value.
 * @return {string} Absolute path to a snapshot directory with a manifest.
 */
function resolveSnapshotDir(value) {
  if (!value) {
    throw new Error("Missing --snapshot=<path-to-export.js-snapshot-dir>");
  }
  const resolved = path.isAbsolute(value) ? value : path.join(process.cwd(), value);
  if (!fs.existsSync(path.join(resolved, "_manifest.json"))) {
    throw new Error(
      `No _manifest.json in ${resolved} - is this really an export.js snapshot dir?`
    );
  }
  return resolved;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshotDir = resolveSnapshotDir(args.snapshot);
  const targetProjectId = resolveProjectId(args.project);
  const execute = !!args.execute;

  const manifest = JSON.parse(
    fs.readFileSync(path.join(snapshotDir, "_manifest.json"))
  );
  const allCollections = Object.keys(manifest.collections);

  let collectionNames;
  if (args.only) {
    const only = new Set(String(args.only).split(",").map((s) => s.trim()));
    collectionNames = allCollections.filter((c) => only.has(c));
  } else {
    const extraSkip = args.skip ?
      String(args.skip).split(",").map((s) => s.trim()) :
      [];
    const skipSet = new Set([...DEFAULT_SKIP, ...extraSkip]);
    collectionNames = allCollections.filter((c) => !skipSet.has(c));
  }
  const skipped = allCollections.filter((c) => !collectionNames.includes(c));

  console.log(`${execute ? "LIVE RUN" : "DRY RUN"}: import`);
  console.log(`  Source snapshot: ${snapshotDir}`);
  console.log(`    (project ${manifest.projectId}, exported ${manifest.exportedAt})`);
  console.log(`  Target project:  ${targetProjectId}`);
  console.log(`  Importing (${collectionNames.length}): ${collectionNames.join(", ")}`);
  console.log(`  Skipping  (${skipped.length}): ${skipped.join(", ")}`);
  console.log("");

  const db = getFirestoreFor(targetProjectId);
  const importedAt = new Date().toISOString();
  const sourceSnapshot = path.basename(snapshotDir);

  // Built regardless of whether "events" is itself in scope this run -
  // event-registrations' "already past" check needs it either way, and the
  // snapshot always has events.json even if --only excludes it from import.
  const eventStartDatesById = new Map();
  const eventsFile = path.join(snapshotDir, "events.json");
  if (fs.existsSync(eventsFile)) {
    const eventDocs = JSON.parse(fs.readFileSync(eventsFile));
    for (const {id, data} of eventDocs) {
      const restored = fromPortable(data, db, admin.firestore);
      const {data: normalized} = normalizeDoc("events", restored, admin.firestore);
      eventStartDatesById.set(id, toDate(normalized.startDate));
    }
  }
  const now = new Date();

  const totals = {create: 0, update: 0, dateFixed: 0, suppressed: 0};
  const allWarnings = [];

  for (const name of collectionNames) {
    const docs = JSON.parse(
      fs.readFileSync(path.join(snapshotDir, `${name}.json`))
    );

    // listDocuments() enumerates refs without reading document content, so
    // this existence check doesn't cost a document read per doc the way a
    // full get() would.
    const existingRefs = await db.collection(name).listDocuments();
    const existingIds = new Set(existingRefs.map((r) => r.id));

    let create = 0;
    let update = 0;
    let dateFixed = 0;
    let suppressed = 0;
    let batch = db.batch();
    let opsInBatch = 0;

    for (const {id, data} of docs) {
      const restored = fromPortable(data, db, admin.firestore);
      const {data: normalized, changed: dateChanged, warnings} =
        normalizeDoc(name, restored, admin.firestore);
      if (dateChanged) dateFixed++;
      allWarnings.push(...warnings);

      // Bake "not new" straight into the write for old purchases / past-
      // event registrations, so the onCreate triggers never mark them "new"
      // in the first place - see lib/suppress-new-status.js.
      let finalData = normalized;
      if (name === "purchases") {
        const suppressedData = suppressOldPurchase(normalized);
        if (suppressedData !== normalized) suppressed++;
        finalData = suppressedData;
      } else if (name === "event-registrations") {
        const suppressedData = suppressPastEventRegistration(normalized, eventStartDatesById, now);
        if (suppressedData !== normalized) suppressed++;
        finalData = suppressedData;
      }

      if (existingIds.has(id)) update++; else create++;

      if (execute) {
        const tagged = {
          ...stripProtectedFields(finalData),
          _dataOps: {importedFromProd: true, importedAt, sourceSnapshot},
        };
        batch.set(db.collection(name).doc(id), tagged, {merge: true});
        opsInBatch++;
        if (opsInBatch >= 400) {
          await batch.commit();
          batch = db.batch();
          opsInBatch = 0;
        }
      }
    }
    if (execute && opsInBatch > 0) {
      await batch.commit();
    }

    totals.create += create;
    totals.update += update;
    totals.dateFixed += dateFixed;
    totals.suppressed += suppressed;

    const dateNote = dateFixed ? `, ${dateFixed} date field(s) normalized` : "";
    const suppressedNote = suppressed ? `, ${suppressed} marked not-new` : "";
    console.log(`  ${name}: ${create} to create, ${update} to update${dateNote}${suppressedNote}`);
  }

  console.log("");
  console.log(
    `Totals: ${totals.create} to create, ${totals.update} to update, ` +
    `${totals.dateFixed} date field(s) normalized, ${totals.suppressed} marked not-new`
  );
  if (allWarnings.length) {
    console.log(`\n${allWarnings.length} warning(s):`);
    allWarnings.slice(0, 20).forEach((w) => console.log(`  - ${w}`));
    if (allWarnings.length > 20) {
      console.log(`  ... and ${allWarnings.length - 20} more`);
    }
  }

  console.log("");
  if (!execute) {
    console.log("Dry run only - review the above, then re-run with --execute to write.");
  } else {
    console.log(`Done - written to ${targetProjectId}.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
