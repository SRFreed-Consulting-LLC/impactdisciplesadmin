#!/usr/bin/env node
// Moves one mail_template out of the System Templates list by setting its
// kind to the SCREEN THAT OWNS IT - for a template that now has an editor
// beside the button that sends it.
//
// The kind names the screen ("fulfillment") rather than merely recording that
// the template moved: there will be several of these, and "which screen owns
// this email" is the question someone actually asks.
//
// This is the migration step for emptying Tools Manager > System Templates:
// each template moves as its own editor lands, and when the list is empty the
// screen can go.
//
// SAFE BY CONSTRUCTION: nothing sends by kind. Every send path resolves a
// template by NAME (transactional-emails.ts's "Sales Receipt",
// PurchasesService's "Amazon Shipping Confirmation", an event's
// emailTemplate) or by DOC ID (a product's followUpEmailId). Changing kind
// changes where an admin FINDS the template and nothing else - which is why
// this refuses to run unless it can name the editor that replaces the list,
// so a template cannot be hidden without somewhere to edit it.
//
//   node scripts/move-template-home.js --project=prod
//     --name="Amazon Shipping Confirmation" --kind=fulfillment
//     --editor="Contacts Manager > Fulfillment > Edit the email this sends"
//   ... add --execute to write. Pass --revert to put it back in the list.
//
// --kind must be one of TEMPLATE_HOME_KINDS in mail.model.ts. Keep the two in
// step: a kind this script writes but the app does not know reads back as
// 'system', and the template simply reappears in the list.
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
  // Mirror of TEMPLATE_HOME_KINDS in
  // src/app/common/models/admin/mail.model.ts. Keep the two in step.
  const HOME_KINDS = ["fulfillment", "product"];

  if (!name) throw new Error('Pass --name="<template name>"');
  if (!revert && !args.kind) {
    throw new Error(`Pass --kind=<home>. Known: ${HOME_KINDS.join(", ")}`);
  }
  if (!revert && !HOME_KINDS.includes(args.kind)) {
    throw new Error(
      `Unknown --kind "${args.kind}". Add it to TEMPLATE_HOME_KINDS in ` +
      `mail.model.ts first, or the app reads it back as 'system' and the ` +
      `template reappears in the list. Known: ${HOME_KINDS.join(", ")}`
    );
  }
  if (!revert && !args.editor) {
    throw new Error('Pass --editor="<where an admin edits it now>". A template must not leave the list without somewhere else to be found.');
  }

  const db = getFirestoreFor(projectId);
  const snap = await db.collection("mail_templates").where("name", "==", name).get();
  if (snap.empty) throw new Error(`No template named "${name}"`);
  if (snap.size > 1) throw new Error(`${snap.size} templates named "${name}" - resolve the duplicate first`);

  const doc = snap.docs[0];
  const current = doc.data().kind ?? "(absent, reads as system)";
  const target = revert ? "system" : args.kind;

  console.log(`${projectId}  (${execute ? "LIVE" : "dry run"})`);
  console.log(`  template : ${name}`);
  console.log(`  doc id   : ${doc.id}`);
  console.log(`  kind     : ${current}  ->  ${target}`);
  if (!revert) console.log(`  edited at: ${args.editor}`);

  if (doc.data().kind === (revert ? undefined : args.kind)) {
    return console.log("  already in that state - nothing to do.");
  }
  if (!execute) return console.log("  Dry run - nothing written. Re-run with --execute.");

  // Reverting DELETES the field rather than writing 'system', so the doc goes
  // back to exactly the shape it had - absent, which kindOf reads as system.
  await doc.ref.update({
    kind: revert ? firestore.FieldValue.delete() : args.kind,
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
