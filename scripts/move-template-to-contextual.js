#!/usr/bin/env node
// Moves one mail_template out of the System Templates list by setting
// kind: 'contextual' - for a template that now has a home on the screen that
// actually sends it.
//
// This is the migration step for emptying Tools Manager > System Templates:
// each template moves as its contextual editor lands, and when the list is
// empty the screen can go.
//
// SAFE BY CONSTRUCTION: nothing sends by kind. Every send path resolves a
// template by NAME (transactional-emails.ts's "Sales Receipt",
// PurchasesService's "Amazon Shipping Confirmation", an event's
// emailTemplate) or by DOC ID (a product's followUpEmailId). Changing kind
// changes where an admin FINDS the template and nothing else - which is why
// this refuses to run unless it can name the contextual editor that replaces
// the list, so a template cannot be hidden without somewhere to edit it.
//
//   node scripts/move-template-to-contextual.js --project=prod \
//     --name="Amazon Shipping Confirmation" \
//     --editor="Contacts Manager > Fulfillment > Edit the email this sends"
//   ... add --execute to write. Pass --revert to put it back to 'system'.
"use strict";

const { resolveProjectId, getFirestoreFor, firestore } = require("./lib/firestore-admin");

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const execute = args.execute === true;
  const revert = args.revert === true;
  const name = args.name;
  if (!name) throw new Error('Pass --name="<template name>"');
  if (!revert && !args.editor) {
    throw new Error('Pass --editor="<where an admin edits it now>". A template must not leave the list without somewhere else to be found.');
  }

  const db = getFirestoreFor(projectId);
  const snap = await db.collection("mail_templates").where("name", "==", name).get();
  if (snap.empty) throw new Error(`No template named "${name}"`);
  if (snap.size > 1) throw new Error(`${snap.size} templates named "${name}" - resolve the duplicate first`);

  const doc = snap.docs[0];
  const current = doc.data().kind ?? "(absent, reads as system)";
  const target = revert ? "system" : "contextual";

  console.log(`${projectId}  (${execute ? "LIVE" : "dry run"})`);
  console.log(`  template : ${name}`);
  console.log(`  doc id   : ${doc.id}`);
  console.log(`  kind     : ${current}  ->  ${target}`);
  if (!revert) console.log(`  edited at: ${args.editor}`);

  if (doc.data().kind === (revert ? undefined : "contextual")) {
    return console.log("  already in that state - nothing to do.");
  }
  if (!execute) return console.log("  Dry run - nothing written. Re-run with --execute.");

  // Reverting DELETES the field rather than writing 'system', so the doc goes
  // back to exactly the shape it had - absent, which kindOf reads as system.
  await doc.ref.update({
    kind: revert ? firestore.FieldValue.delete() : "contextual",
  });

  const after = (await doc.ref.get()).data().kind;
  console.log(`  now      : ${after ?? "(absent, reads as system)"}`);
  console.log(revert
    ? "  It is back on Tools Manager > System Templates."
    : "  It has left Tools Manager > System Templates. Sending is unaffected.");
}

main().catch((e) => {
  console.error("  " + e.message);
  process.exit(1);
});
