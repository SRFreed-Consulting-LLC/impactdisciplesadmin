#!/usr/bin/env node
// Puts back contacts deleted by delete-nameless-contacts.js, from the export
// that deletion required.
//
// The export is the undo, so it has to actually work - this exists so that is
// a tested claim rather than an assumption. Restores each record under its
// ORIGINAL document id, and refuses to overwrite an id that exists again
// (someone re-subscribing would have created a fresh record, and that one is
// newer and truer than the copy in the file).
//
//   node scripts/restore-contacts.js --project=prod --from=<export.json>
//   ... add --execute to actually write.
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

const BATCH = 400;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const execute = args.execute === true;
  if (!args.from) throw new Error("Pass --from=<export json>");

  const exported = JSON.parse(fs.readFileSync(args.from, "utf8"));
  if (exported.project !== projectId) {
    throw new Error(`Export is from "${exported.project}" but --project resolved to "${projectId}".`);
  }

  const db = getFirestoreFor(projectId);
  console.log(`${projectId}  (${execute ? "LIVE" : "dry run"})`);
  console.log(`  export  : ${args.from}`);
  console.log(`  records : ${exported.records.length}`);

  const toWrite = [];
  let existing = 0;
  for (const rec of exported.records) {
    const ref = db.collection("customers").doc(rec.id);
    if ((await ref.get()).exists) { existing++; continue; }
    // Strip the fields the export added for reporting - they are not part of
    // the record and must not be written back into it.
    const { id, _purchases, _registrations, _safeToDelete, ...data } = rec;
    void id; void _purchases; void _registrations; void _safeToDelete;
    toWrite.push({ ref, data });
  }

  console.log(`  already present, left alone : ${existing}`);
  console.log(`  will restore ................ ${toWrite.length}`);
  if (!execute) return console.log("  Dry run - nothing written. Re-run with --execute.");

  for (let i = 0; i < toWrite.length; i += BATCH) {
    const batch = db.batch();
    toWrite.slice(i, i + BATCH).forEach((w) => batch.set(w.ref, w.data));
    await batch.commit();
  }
  const after = await db.collection("customers").count().get();
  console.log(`  restored ${toWrite.length}. customers now: ${after.data().count}`);
}

main().catch((e) => {
  console.error("  " + e.message);
  process.exit(1);
});
