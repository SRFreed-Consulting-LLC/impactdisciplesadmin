#!/usr/bin/env node
// Normalises every stored US state to its two-letter USPS code, and every
// stored country to its ISO alpha-2 code.
//
// (Was normalize-state-spellings.js. Renamed 2026-09-04 when the country
// half was added - the two live in the same address objects and there is no
// reason to walk the same 8,000 documents twice.)
//
// THE PROBLEM. The two collections that hold the most addresses disagreed
// with each other almost perfectly - `customers` was 85% state codes,
// `purchases` 99.8% full names - because the admin's address form and the
// storefront's checkout both stored their picker's DISPLAY value while the
// shipping screen stored the code. Country was worse: every writer stored
// the display name, so it was 100% names plus a stray "USA". Consequences,
// all of them live:
//
//   - Reports Manager's State filter reached ~15% of the contacts it should.
//     src/app/common/utils/state-variants.ts exists solely to query both
//     spellings, and its header carries the counts.
//   - ShipEngine took production down TWICE on 2026-09-03 over this, once
//     per field: "United States" as a country_code made every parcel look
//     international and refused every label, and fixing that made the vendor
//     start enforcing a two-character state, which 502'd every rate quote.
//     See lib/country-code.js and lib/state-code.js.
//
// See those two files for why CODES are the canonical form and how each
// value is classified. Values they cannot resolve are LEFT ALONE and listed.
//
// Dry-run by default. Pass --execute to write.
//
// Usage:
//   node scripts/normalize-address-codes.js --project=dev
//   node scripts/normalize-address-codes.js --project=dev --execute
//   node scripts/normalize-address-codes.js --project=prod --execute

const {resolveProjectId, getFirestoreFor} = require("./lib/firestore-admin");
const {tenantPath} = require("./lib/tenancy");
const {toStateCode} = require("./lib/state-code");
const {toCountryCode} = require("./lib/country-code");

// Every path a state or country is stored at, per collection, with the
// canonicaliser each one takes. Dotted paths only - none of these live
// inside an array today, and one that ever does needs its own walker rather
// than a guess here.
//
// Derived from a full sweep of both projects (2026-09-04), not from memory:
// anything not listed below held no such values in either dev or prod.
// `shipping-labels` is deliberately absent - its addresses are built by the
// Shipping Labels screen, which has always stored codes.
//
// NOT INCLUDED, and it would be a real bug to add it: `libraryUsers`
// location.country and the `discussionGroups` location. Those are the
// reader side's patron geo-data, they already hold ISO codes, and
// functions/src/library-groups.functions.ts compares one against the
// literal "US". They are a different field that happens to share a name.
const ADDRESS_ROOTS = {
  purchases: ["billingAddress", "shippingAddress"],
  customers: ["billingAddress", "shippingAddress"],
  organizations: ["address", "billingAddress", "shippingAddress"],
  locations: ["address", "billingAddress", "shippingAddress"],
  // The denormalised venue snapshot the PUBLIC SITE renders through its
  // VenuePipe. It is a copy of a location's address taken at save time, so
  // it drifts on its own schedule and has to be normalised in its own right
  // - fixing `locations` alone would leave the published page saying
  // "Georgia" until somebody happened to re-save the event.
  events: ["venue.address"],
  config: ["address"],
  admin_users: ["billingAddress", "shippingAddress"],
  coaches: ["shippingAddress"],
  impact_team: ["shippingAddress"],
};

// One entry per (path, canonicaliser). Built from the roots above so a new
// address-bearing collection is one line, not six.
const FIELDS_BY_COLLECTION = Object.fromEntries(
  Object.entries(ADDRESS_ROOTS).map(([collection, roots]) => [
    collection,
    roots.flatMap((root) => [
      {path: `${root}.state`, canonicalise: toStateCode, kind: "state"},
      {path: `${root}.country`, canonicalise: toCountryCode, kind: "country"},
    ]),
  ])
);

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
    if (eq === -1) args[raw.slice(2)] = true;
    else args[raw.slice(2, eq)] = raw.slice(eq + 1);
  }
  return args;
}

/**
 * Reads a dotted path off a document.
 * @param {Object} obj Document data.
 * @param {string} dotted Dotted field path.
 * @return {*} The value, or undefined.
 */
function readPath(obj, dotted) {
  return dotted.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const execute = !!args.execute;
  const db = getFirestoreFor(projectId);

  console.log(`${execute ? "LIVE RUN" : "DRY RUN"} against "${projectId}"`);
  console.log("");

  const unknowns = new Map();
  const cleanedNotes = [];
  let totalWrites = 0;

  for (const [collection, fields] of Object.entries(FIELDS_BY_COLLECTION)) {
    // THROUGH THE SEAM. A bare db.collection("purchases") reads a top-level
    // path that has held zero documents since the 2026-09-02 tenancy
    // cutover, and reports "0 documents, nothing to do" - which is exactly
    // how scripts/fix-date-shapes.js sat broken and looking successful.
    const path = tenantPath(collection);
    const snap = await db.collection(path).get();

    const counts = {
      state: {ok: 0, converted: 0, cleaned: 0, unknown: 0},
      country: {ok: 0, converted: 0, cleaned: 0, unknown: 0},
    };
    let docsChanged = 0;
    let batch = db.batch();
    let ops = 0;

    for (const doc of snap.docs) {
      const data = doc.data();
      // Dotted keys in a single update() so only the leaf is written -
      // rewriting the whole address would clobber a concurrent edit to a
      // sibling field, and rewriting the whole DOC would clobber the rest
      // of a purchase.
      const update = {};

      for (const {path: field, canonicalise, kind} of fields) {
        const raw = readPath(data, field);
        if (raw === undefined) continue;
        const result = canonicalise(raw);
        counts[kind][result.status]++;
        if (result.status === "unknown") {
          const key = `${kind}: ${String(raw)}`;
          unknowns.set(key, (unknowns.get(key) || 0) + 1);
          continue;
        }
        if (result.value !== raw) {
          update[field] = result.value;
          if (result.status === "cleaned") {
            cleanedNotes.push(`${collection}/${doc.id} ${field}: ${result.note}`);
          }
        }
      }

      if (Object.keys(update).length === 0) continue;
      docsChanged++;
      if (execute) {
        batch.update(doc.ref, update);
        ops++;
        if (ops >= 400) {
          await batch.commit();
          batch = db.batch();
          ops = 0;
        }
      }
    }

    if (execute && ops > 0) await batch.commit();
    totalWrites += docsChanged;

    // Reported per FIELD KIND, not merged. A single "converted" total
    // cannot tell you whether the country pass did anything, which is the
    // one question this run exists to answer.
    const line = (kind) =>
      `${kind} [unchanged ${String(counts[kind].ok).padStart(5)} ` +
      `name->code ${String(counts[kind].converted).padStart(5)} ` +
      `cleaned ${String(counts[kind].cleaned).padStart(3)} ` +
      `unresolved ${String(counts[kind].unknown).padStart(3)}]`;

    console.log(
      `${collection.padEnd(15)} ${String(snap.size).padStart(5)} docs  ` +
      `${line("state")}  ${line("country")}  ` +
      `=> ${docsChanged} doc(s) ${execute ? "updated" : "would change"}`
    );
  }

  if (cleanedNotes.length) {
    console.log("");
    console.log(`Cleaned (each one listed - none of these are silent):`);
    for (const note of cleanedNotes) console.log("  " + note);
  }

  if (unknowns.size) {
    console.log("");
    console.log("LEFT UNCHANGED - not recognisable as a US state. Decide these by hand:");
    for (const [value, count] of [...unknowns].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${JSON.stringify(value)} x${count}`);
    }
  }

  console.log("");
  console.log(`${totalWrites} document(s) ${execute ? "updated" : "would be updated"}.`);
  if (!execute) console.log("Dry run only - re-run with --execute to write.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
