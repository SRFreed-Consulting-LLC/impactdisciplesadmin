#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// Re-creates the two CODE-OWNED mail_templates under fixed, known document
// ids, so the send paths can stop resolving them by name.
//
// Why. A template's `name` is an ordinary text field an admin can edit, and
// these two are the only templates nothing in the DATA points at - the code
// names them. Renaming one stopped that email with no error anywhere, and
// the editing screen gave no hint. A document id cannot be edited, so it is
// the right handle. But the ids these documents were created with are not
// the same on both projects (Amazon Shipping Confirmation was seeded per
// project and got a random id each time), and Firestore cannot rename a
// document - so the only way to have one id that works everywhere is to
// re-create them under it.
//
// COPY, VERIFY, THEN DELETE - in that order, and the delete is skipped
// entirely unless the copy read back identical. A half-done run leaves TWO
// documents, which the send path handles (it prefers the pinned id), rather
// than none, which would stop receipts.
//
//   node scripts/pin-template-ids.js --project=dev
//   ... add --execute to write.
"use strict";

const fs = require("fs");
const path = require("path");
const { resolveProjectId, getFirestoreFor } = require("./lib/firestore-admin");

const OUT_DIR = path.join(__dirname, "output");

// Mirror of MAIL_TEMPLATE_IDS in
// functions/src/utils/mail-templates.functions.ts and the constants in
// src/app/common/services/data/purchases.service.ts. Keep all three in step.
const PINNED = [
  { id: "tmpl-sales-receipt", name: "Sales Receipt" },
  { id: "tmpl-amazon-shipping-confirmation", name: "Amazon Shipping Confirmation" },
];

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

const stable = (v) => JSON.stringify(v, Object.keys(v ?? {}).sort());

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const execute = args.execute === true;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const db = getFirestoreFor(projectId);

  console.log(`${projectId}  (${execute ? "LIVE" : "dry run"})`);

  const plan = [];
  for (const target of PINNED) {
    const pinned = await tenantCollection(db, "mail_templates").doc(target.id).get();
    const byName = await tenantCollection(db, "mail_templates")
      .where("name", "==", target.name).get();

    const others = byName.docs.filter((d) => d.id !== target.id);

    console.log("");
    console.log(`  ${target.name}`);
    console.log(`    pinned id ${target.id} exists : ${pinned.exists}`);
    console.log(`    other documents by that name  : ${others.length}` +
      (others.length ? ` (${others.map((d) => d.id).join(", ")})` : ""));

    if (pinned.exists && !others.length) {
      console.log("    already pinned - nothing to do.");
      continue;
    }
    if (!pinned.exists && others.length > 1) {
      throw new Error(
        `${others.length} documents named "${target.name}" and no pinned id. ` +
        "Resolve the duplicate by hand first - this script will not guess."
      );
    }
    if (pinned.exists && others.length) {
      console.log("    pinned id ALREADY exists, and so does an old copy.");
      console.log("    -> will delete the old copy only (the pinned one wins).");
      plan.push({ target, source: null, deleteIds: others.map((d) => d.id) });
      continue;
    }
    console.log(`    -> will copy ${others[0].id} to ${target.id}, then delete it.`);
    plan.push({ target, source: others[0], deleteIds: [others[0].id] });
  }

  if (!plan.length) {
    console.log("");
    console.log("  Nothing to do.");
    return;
  }
  if (!execute) {
    console.log("");
    console.log("  Dry run - nothing written. Re-run with --execute.");
    return;
  }

  for (const step of plan) {
    if (step.source) {
      const data = step.source.data();
      const backup = path.join(
        OUT_DIR, `template-pinned-${step.target.id}-${projectId}.json`
      );
      fs.writeFileSync(backup, JSON.stringify({
        project: projectId, pinnedAt: new Date().toISOString(),
        originalId: step.source.id, newId: step.target.id, data
      }, null, 2), "utf8");
      console.log("");
      console.log(`  backed up ${step.source.id} to ${backup}`);

      await tenantCollection(db, "mail_templates").doc(step.target.id).set(data);

      // VERIFY before deleting anything. A copy that did not land exactly is
      // the one case where deleting the original loses the template.
      const check = await tenantCollection(db, "mail_templates").doc(step.target.id).get();
      if (!check.exists || stable(check.data()) !== stable(data)) {
        throw new Error(
          `Copy to ${step.target.id} did not read back identical - ` +
          `ORIGINAL ${step.source.id} LEFT IN PLACE. Nothing was lost.`
        );
      }
      console.log(`  copied and verified: ${step.target.id}`);
    }

    for (const id of step.deleteIds) {
      await tenantCollection(db, "mail_templates").doc(id).delete();
      console.log(`  deleted old document ${id}`);
    }
  }

  console.log("");
  for (const target of PINNED) {
    const doc = await tenantCollection(db, "mail_templates").doc(target.id).get();
    const dupes = (await tenantCollection(db, "mail_templates")
      .where("name", "==", target.name).get()).docs.filter((d) => d.id !== target.id);
    console.log(`  ${target.id}: exists=${doc.exists} name=${JSON.stringify(doc.data()?.name)} strays=${dupes.length}`);
  }
}

main().catch((e) => {
  console.error("  " + e.message);
  process.exit(1);
});
