#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// Exports, then deletes, the three imported-from-Mailchimp CAMPAIGN
// templates: "Event Invite (Mailchimp)", "Newsletter 2021 (Mailchimp)" and
// "Impact Live Template (Mailchimp)".
//
// They are NOT orphans in the usual sense - nothing in events/products
// references them, but they are `kind: campaign` with a builder design, so
// they appear in the campaign email composer's template gallery
// (template-picker-dialog filters on exactly design + kind). Deleting them
// removes three starting points an author can pick, which is the intent
// here; they are 2021-era Mailchimp layouts and that account is closing.
//
// EXPORTS FIRST, always: ~200 KB of builder design JSON that may not exist
// anywhere else once Mailchimp is gone. The export is written before a
// single delete is issued, and the run aborts if it cannot be written.
//
// Matches by NAME and re-checks `kind === 'campaign'` before deleting, so a
// system template that happens to share a name can never be caught.
//
// Usage:
//   node scripts/retire-mailchimp-templates.js --project=dev
//   node scripts/retire-mailchimp-templates.js --project=dev --execute
"use strict";

const fs = require("fs");
const path = require("path");
const {resolveProjectId, getFirestoreFor} = require("./lib/firestore-admin");

const NAMES = [
  "Event Invite (Mailchimp)",
  "Newsletter 2021 (Mailchimp)",
  "Impact Live Template (Mailchimp)",
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(String(args.project || "dev"));
  const db = getFirestoreFor(projectId);

  const snap = await tenantCollection(db, "mail_templates").get();
  const targets = snap.docs.filter((d) => {
    const data = d.data();
    return NAMES.includes(data.name) && data.kind === "campaign";
  });

  if (!targets.length) {
    console.log(`Nothing to do in ${projectId} - none of the three present.`);
    return;
  }

  console.log(`${projectId}: ${targets.length} template(s) matched`);
  targets.forEach((d) => {
    const x = d.data();
    console.log(`   ${d.id}  "${x.name}"  design=${x.design ? "builder" : "none"}` +
      `  html=${(x.html || "").length} chars`);
  });

  if (!args.execute) {
    console.log("\n[dry run] re-run with --execute to export and delete.");
    return;
  }

  // Export BEFORE deleting. If this throws, nothing is removed.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(__dirname, "backups", `${projectId}-mailchimp-templates-${stamp}`);
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, "mail_templates.json");
  fs.writeFileSync(file, JSON.stringify(
    targets.map((d) => ({id: d.id, ...d.data()})), null, 2));
  const bytes = fs.statSync(file).size;
  if (bytes < 1000) {
    throw new Error(`Export looks truncated (${bytes} bytes) - refusing to delete.`);
  }
  console.log(`\nExported ${bytes} bytes -> ${file}`);

  for (const d of targets) {
    await d.ref.delete();
    console.log(`   deleted ${d.id} "${d.data().name}"`);
  }
  console.log(`\nDone. Restore from the export above if this was a mistake.`);
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
