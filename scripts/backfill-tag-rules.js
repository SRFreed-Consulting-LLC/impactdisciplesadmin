#!/usr/bin/env node
// Retroactively applies tag rules across historic purchases and
// event-registrations, by running the REAL sweep logic - it requires
// runRuleBackfill() from the COMPILED functions output (functions/lib), so
// there is no second matcher implementation to drift (`cd functions &&
// npm run build` first if functions/src changed). Same semantics as the
// per-rule "Apply to Existing" button on Campaigns Manager > Tag Rules:
// deterministic tag_applications ids make re-runs idempotent, customers
// that don't exist are skipped (customer-upsert backfills own creating
// customers), and the HISTORIC activity date is the tag's anchor.
//
// Usage:
//   node scripts/backfill-tag-rules.js --project=dev              # list rules only
//   node scripts/backfill-tag-rules.js --project=dev --execute    # sweep ALL active rules
//   node scripts/backfill-tag-rules.js --project=dev --rule=dmc-books --execute

const path = require("path");
const {resolveProjectId, getFirestoreFor} = require("./lib/firestore-admin");
const {runRuleBackfill} = require(
  path.join(__dirname, "..", "functions", "lib", "tag-rules.functions.js")
);

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
  const db = getFirestoreFor(projectId);

  let query = db.collection("tag_rules");
  const snap = await query.get();
  let rules = snap.docs.map((doc) => ({id: doc.id, ...doc.data()}));
  if (args.rule) {
    rules = rules.filter((rule) => rule.id === args.rule);
    if (rules.length === 0) {
      console.error(`No tag_rules doc with id "${args.rule}".`);
      process.exit(1);
    }
  } else {
    rules = rules.filter((rule) => rule.active !== false);
  }

  console.log(`${rules.length} rule(s) to sweep on ${projectId}:`);
  for (const rule of rules) {
    console.log(`  ${rule.id} — "${rule.name}" [${rule.trigger}] => ` +
      (rule.trigger === "summit-registration" ?
        `"${rule.paidTag}" (paid) / "${rule.tag}" (free)` : `"${rule.tag}"`));
  }
  if (!args.execute) {
    console.log("\nDry run - pass --execute to sweep (writes customer tags " +
      "and tag_applications).");
    return;
  }

  for (const rule of rules) {
    console.log(`\nSweeping ${rule.id}...`);
    const stats = await runRuleBackfill(db, rule);
    console.log(`  scanned=${stats.scanned} matched=${stats.matched} ` +
      `customersTagged=${stats.customersTagged} ` +
      `applicationsCreated=${stats.applicationsCreated} ` +
      `skippedNoCustomer=${stats.skippedNoCustomer}`);
  }
  console.log("\nDone.");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
