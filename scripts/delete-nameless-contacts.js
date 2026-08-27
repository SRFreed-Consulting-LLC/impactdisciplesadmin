#!/usr/bin/env node
// Deletes `customers` records that have NO LAST NAME and have never bought
// anything or attended an event (owner's rule, 2026-08-27). A newsletter
// subscription does not protect a record.
//
// Refuses to run without an export file: the export IS the undo. Pass the JSON
// written by export-nameless-contacts.js, and this deletes exactly the ids in
// it that still satisfy the rule - re-checked live, so a record that gained a
// purchase between the export and the deletion is skipped rather than trusted
// from a stale file.
//
// Restore with:  node scripts/restore-contacts.js --project=X --from=<export>
//
//   node scripts/delete-nameless-contacts.js --project=prod --from=<export.json>
//   ... add --execute to actually delete.
"use strict";

const fs = require("fs");
const { resolveProjectId, getFirestoreFor } = require("./lib/firestore-admin");

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

const blank = (v) => typeof v !== "string" || v.trim() === "";
const norm = (v) => String(v ?? "").trim().toLowerCase();
const BATCH = 400;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const execute = args.execute === true;
  if (!args.from) throw new Error("Pass --from=<export json>. The export is the only undo.");

  const exported = JSON.parse(fs.readFileSync(args.from, "utf8"));
  if (exported.project !== projectId) {
    throw new Error(`Export is from "${exported.project}" but --project resolved to "${projectId}".`);
  }
  const ids = new Set(exported.records.map((r) => r.id));
  console.log(`${projectId}  (${execute ? "LIVE" : "dry run"})`);
  console.log(`  export      : ${args.from}`);
  console.log(`  ids in file : ${ids.size}`);

  const db = getFirestoreFor(projectId);

  // Re-derive who has ever bought or attended, live. Full scan and lowercase
  // BOTH sides - 437 of these emails are stored with upper-case characters on
  // prod, so an `in` query on lowercased values silently misses matches.
  const protectedEmails = new Set();
  for (const coll of ["purchases", "event-registrations"]) {
    const snap = await db.collection(coll).get();
    snap.forEach((d) => { if (d.data().email) protectedEmails.add(norm(d.data().email)); });
  }
  console.log(`  emails with a purchase or registration: ${protectedEmails.size}`);

  const toDelete = [];
  const skipped = { missing: 0, gainedName: 0, gainedHistory: 0 };
  for (const id of ids) {
    const ref = db.collection("customers").doc(id);
    const snap = await ref.get();
    if (!snap.exists) { skipped.missing++; continue; }
    const c = snap.data();
    if (!blank(c.lastName)) { skipped.gainedName++; continue; }
    if (protectedEmails.has(norm(c.email))) { skipped.gainedHistory++; continue; }
    toDelete.push({ ref, email: c.email });
  }

  console.log("");
  console.log(`  will delete ....................... ${toDelete.length}`);
  console.log(`  skipped, already gone ............. ${skipped.missing}`);
  console.log(`  skipped, now has a last name ...... ${skipped.gainedName}`);
  console.log(`  skipped, now has a purchase/event . ${skipped.gainedHistory}`);

  if (!execute) {
    console.log("");
    console.log("  Dry run - nothing deleted. Re-run with --execute.");
    return;
  }

  for (let i = 0; i < toDelete.length; i += BATCH) {
    const batch = db.batch();
    toDelete.slice(i, i + BATCH).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  const after = await db.collection("customers").count().get();
  console.log("");
  console.log(`  deleted ${toDelete.length}. customers now: ${after.data().count}`);
  console.log(`  restore with: node scripts/restore-contacts.js --project=${args.project} --from=${args.from} --execute`);
}

main().catch((e) => {
  console.error("  " + e.message);
  process.exit(1);
});
