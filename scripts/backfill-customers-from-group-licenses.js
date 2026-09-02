#!/usr/bin/env node
// One-time backfill for the "customers" collection from library patrons who
// hold a book WITHOUT ever having transacted with us.
//
// WHY THESE PEOPLE WERE MISSED. Contacts are created automatically from
// storefront checkout (customer-upsert.functions.ts) and event registrations
// (event-registration-customer-upsert.functions.ts). Both begin with the
// person BUYING or REGISTERING. Two routes into the library involve no
// transaction by the reader at all:
//
//   group-license  - a leader buys licences in bulk and assigns one. The
//                    LEADER transacted, so the leader became the contact and
//                    the recipient did not.
//   legacyImport   - carried over from the old system, before any of this
//                    pipeline existed.
//
// An audit on 2026-09-02 found 89 of 96 reader patrons already present as
// contacts; the gap was these two routes. assignGroupLicense now creates the
// contact itself going forward (see recordLicenceRecipientAsContact in
// functions/src/library-group-licenses.functions.ts) - this script is only
// for the people who came before that.
//
// NOT A PERSON, NEVER A CONTACT: app_access@google.com is the Google Play
// app-access placeholder. It holds a licence so a reviewer can open a book.
// It is excluded explicitly rather than by a heuristic.
//
// Matches by email like every other customer path, so anyone already on file
// is left completely alone - no overwrite, no duplicate, no pending change.
// A patron whose profile carries no name still gets a contact: an empty name
// is worth more than no record at all, and the name can be filled in later.
//
// Dry-run by default. Pass --execute to write. --project=dev|prod is
// required, no default (see lib/firestore-admin.js).
"use strict";

const {tenantCollection} = require("./lib/tenancy");
const {resolveProjectId, getFirestoreFor} = require("./lib/firestore-admin");

/**
 * @param {string[]} argv Raw arguments.
 * @return {object} Parsed --flags.
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

/** Placeholder accounts that must never become contacts. */
const NOT_A_PERSON = new Set(["app_access@google.com"]);

/** The licence sources that produce no transaction of the reader's own. */
const UNTRANSACTED_SOURCES = new Set(["group-license"]);

const norm = (value) => String(value || "").trim().toLowerCase();

/**
 * Whether this patron reached their books without transacting themselves.
 * @param {object} data A libraryUsers document's data.
 * @return {string|null} The reason, or null when they did transact.
 */
function untransactedReason(data) {
  const licences = Array.isArray(data.bookLicenses) ? data.bookLicenses : [];
  if (licences.some((l) => UNTRANSACTED_SOURCES.has(l && l.source))) {
    return "group-license";
  }
  // A legacy import predates source tracking entirely; only count one that
  // actually holds a book, or this sweeps in empty shells.
  const books = Array.isArray(data.licensedBookIds) ? data.licensedBookIds : [];
  if (data.legacyImport === true && books.length > 0) {
    return "legacyImport";
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const EXECUTE = !!args.execute;
  const db = getFirestoreFor(projectId);

  console.log(`${EXECUTE ? "LIVE RUN" : "DRY RUN"} against "${projectId}"\n`);

  const existing = new Set();
  const customersSnap = await tenantCollection(db, "customers").get();
  customersSnap.forEach((doc) => {
    const email = norm(doc.get("email"));
    if (email) existing.add(email);
  });

  const patronsSnap = await tenantCollection(db, "libraryUsers").get();
  const candidates = [];
  const skipped = {alreadyContact: 0, transacted: 0, placeholder: 0};

  patronsSnap.forEach((doc) => {
    const email = norm(doc.id) || norm(doc.get("email"));
    if (!email) return;
    if (NOT_A_PERSON.has(email)) {
      skipped.placeholder++;
      return;
    }
    const reason = untransactedReason(doc.data());
    if (!reason) {
      skipped.transacted++;
      return;
    }
    if (existing.has(email)) {
      skipped.alreadyContact++;
      return;
    }
    candidates.push({
      email,
      firstName: doc.get("firstName") || "",
      lastName: doc.get("lastName") || "",
      reason,
    });
  });

  candidates.sort((a, b) => a.email.localeCompare(b.email));

  console.log(`customers on file:        ${existing.size}`);
  console.log(`library patrons:          ${patronsSnap.size}`);
  console.log(`  transacted themselves:  ${skipped.transacted}`);
  console.log(`  already a contact:      ${skipped.alreadyContact}`);
  console.log(`  placeholder, excluded:  ${skipped.placeholder}` +
    `  (${[...NOT_A_PERSON].join(", ")})`);
  console.log(`WILL CREATE:              ${candidates.length}`);

  candidates.forEach((c) => {
    const name = `${c.firstName} ${c.lastName}`.trim() || "(no name on file)";
    console.log(`  ${c.email.padEnd(34)} ${name.padEnd(22)} ${c.reason}`);
  });

  if (!candidates.length) {
    console.log("\nNothing to do.");
    return;
  }
  if (!EXECUTE) {
    console.log("\nDRY RUN - nothing written. Re-run with --execute.");
    return;
  }

  let created = 0;
  for (const c of candidates) {
    // Same shape findOrCreateCustomer writes, so a record created here is
    // indistinguishable from one the trigger would have made.
    await tenantCollection(db, "customers").add({
      email: c.email,
      firstName: c.firstName,
      lastName: c.lastName,
      role: "Customer",
      source: c.reason,
      notes: [],
      pendingChanges: [],
      tags: [],
    });
    created++;
  }
  console.log(`\nCreated ${created} contact(s).`);
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exitCode = 1;
});
