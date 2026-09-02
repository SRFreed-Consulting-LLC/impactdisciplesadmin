#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// Retires a mail_template: repoints whatever still references it, then
// deletes it.
//
// The order matters and is the whole reason this is a script rather than two
// console clicks. An event binds its confirmation BY NAME, so deleting a
// template first leaves every event pointing at a name that resolves to
// nothing - and a registration then sends NO email at all, silently. Loud
// beats silent: reassign first, delete second, and refuse to delete while
// anything still points at the name.
//
//   node scripts/retire-template.js --project=dev --name="Seminar Template" \
//     --reassign-to="Event Registration Confirmation"
//   ... add --execute to write. Everything is backed up to scripts/output/
//   first, including the full template document, so this is undoable by hand.
//
// REFUSES outright for templates resolved by a literal name inside code -
// deleting one of those breaks a send path that no test would catch.
"use strict";

const fs = require("fs");
const path = require("path");
const { resolveProjectId, getFirestoreFor } = require("./lib/firestore-admin");

const OUT_DIR = path.join(__dirname, "output");

// Templates the CODE owns: nothing in the data points at them, so the send
// path addresses them directly. Keyed by pinned document id since 2026-08-27
// - the name is now free to change, the id is not, so the id is what a guard
// has to watch. Deleting one of these stops that email with no error.
const CODE_CRITICAL_IDS = new Set([
  "tmpl-sales-receipt",
  "tmpl-amazon-shipping-confirmation"
]);

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

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const execute = args.execute === true;
  const name = args.name;
  const reassignTo = args["reassign-to"];

  if (!name) throw new Error('Pass --name="<template name>"');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const db = getFirestoreFor(projectId);

  const snap = await tenantCollection(db, "mail_templates").where("name", "==", name).get();
  if (snap.empty) throw new Error(`No template named "${name}" on ${projectId}.`);
  if (snap.size > 1) throw new Error(`${snap.size} templates named "${name}".`);
  const doc = snap.docs[0];

  // Checked on the ID, after the lookup: a renamed code-owned template must
  // still be refused, and its name no longer identifies it.
  if (CODE_CRITICAL_IDS.has(doc.id)) {
    throw new Error(
      `${doc.id} is a template the CODE resolves directly (a send path holds ` +
      "that id). Deleting it stops that email with no error anywhere. " +
      "Change the code first."
    );
  }

  console.log(`${projectId}  (${execute ? "LIVE" : "dry run"})`);
  console.log(`  retiring : ${name}`);
  console.log(`  doc id   : ${doc.id}`);
  console.log(`  kind     : ${doc.data().kind ?? "(absent, reads as system)"}`);

  // Everything that can reference a template: events by NAME, products by
  // DOC ID. Both are checked - a script that only knew about one would
  // cheerfully delete a template a product still sends.
  const [events, products] = await Promise.all([
    tenantCollection(db, "events").get(),
    tenantCollection(db, "products").get()
  ]);

  const usingEvents = [];
  events.forEach((d) => {
    if (d.data().emailTemplate === name) {
      usingEvents.push({
        id: d.id,
        name: d.data().eventName ?? "(untitled)",
        active: d.data().isActive !== false
      });
    }
  });
  const usingProducts = [];
  products.forEach((d) => {
    if (d.data().followUpEmailId === doc.id) {
      usingProducts.push({ id: d.id, name: d.data().title ?? "(untitled)" });
    }
  });

  console.log(`  events referencing it   : ${usingEvents.length}`);
  usingEvents.forEach((e) => console.log(`      ${e.active ? "[active]  " : "[inactive]"} ${e.name}`));
  console.log(`  products referencing it : ${usingProducts.length}`);
  usingProducts.forEach((p) => console.log(`      ${p.name}`));

  if (usingProducts.length) {
    throw new Error(
      "A product still sends this as its follow-up. Repoint it on Store " +
      "Manager > Products first - this script does not touch products."
    );
  }

  let target = null;
  if (usingEvents.length) {
    if (!reassignTo) {
      throw new Error(
        `${usingEvents.length} event(s) still name this template. Pass ` +
        '--reassign-to="<other template>" - deleting it without that leaves ' +
        "them pointing at nothing, and a registration then sends no email at all."
      );
    }
    const targetSnap = await tenantCollection(db, "mail_templates")
      .where("name", "==", reassignTo).get();
    if (targetSnap.empty) throw new Error(`No template named "${reassignTo}" to reassign to.`);
    if (targetSnap.size > 1) throw new Error(`${targetSnap.size} templates named "${reassignTo}".`);
    target = targetSnap.docs[0];
    console.log("");
    console.log(`  reassign to : ${reassignTo}  (${target.id}, kind ${target.data().kind ?? "system"})`);
  }

  if (!execute) {
    console.log("");
    console.log("  Dry run - nothing written. Re-run with --execute.");
    return;
  }

  // Full document, so this is recoverable by hand if the call was wrong.
  const backup = path.join(OUT_DIR, `template-retired-${slug(name)}-${projectId}.json`);
  fs.writeFileSync(backup, JSON.stringify({
    project: projectId,
    retiredAt: new Date().toISOString(),
    template: { id: doc.id, ...doc.data() },
    reassignedTo: reassignTo ?? null,
    events: usingEvents
  }, null, 2), "utf8");
  console.log("");
  console.log(`  backed up to: ${backup}`);

  // Reassign BEFORE deleting, so there is never a moment where an event
  // points at a name that does not exist.
  for (const e of usingEvents) {
    await tenantCollection(db, "events").doc(e.id).update({ emailTemplate: reassignTo });
  }
  if (usingEvents.length) {
    console.log(`  reassigned ${usingEvents.length} event(s) to "${reassignTo}"`);
  }

  await doc.ref.delete();
  const gone = !(await doc.ref.get()).exists;
  console.log(`  deleted "${name}": ${gone}`);

  const left = await tenantCollection(db, "mail_templates").get();
  const system = [];
  left.forEach((d) => {
    const k = d.data().kind ?? "system";
    if (k === "system") system.push(d.data().name);
  });
  console.log(`  System Templates remaining: ${system.length}  (${system.join(", ") || "none"})`);
}

main().catch((e) => {
  console.error("  " + e.message);
  process.exit(1);
});
