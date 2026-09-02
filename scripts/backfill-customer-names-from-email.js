#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// One-time (idempotent) backfill for the 285 `customers` docs that arrived
// through the Mailchimp audience reconcile carrying an email address and
// nothing else - no firstName, no lastName, no phone, no address. The only
// signal available is the address itself, so the names written here are
// READ OFF THE EMAIL and are best guesses, reviewed by hand before this
// script was committed (see scripts/data/customer-name-guesses.json, which
// carries a `basis` string per record explaining where the guess came from).
//
// Two kinds of entry live in that file:
//
//   kind: "person"       - a real name (or half of one) is in the address.
//                          bill.brewer@ -> Bill / Brewer; jporter@ -> the
//                          surname only, firstName deliberately left blank
//                          rather than writing a bare "J.". Addresses whose
//                          split or name order was a coin flip
//                          (chesterjacob12@, roscoedon@) are NOT in the
//                          file at all.
//   kind: "organization" - a shared inbox on an organization's own domain
//                          (info@, office@, church@, pastor@, pcc@ ...).
//                          There is no person to name, so the org name -
//                          derived from the domain - goes in lastName with
//                          firstName left blank, which is what the Customers
//                          list and campaign greetings read from. These are
//                          NOT linked to the `organizations` collection;
//                          none of these domains has an org doc today
//                          (user decision, 2026-08-23).
//
// Safety: only writes a doc whose firstName AND lastName are both still
// blank and whose email still matches the plan, so a re-run after an admin
// has corrected a guess leaves that correction alone.
//
//   node scripts/backfill-customer-names-from-email.js --project=prod
//   node scripts/backfill-customer-names-from-email.js --project=prod --execute

const fs = require("fs");
const path = require("path");
const { resolveProjectId, getFirestoreFor } = require("./lib/firestore-admin");

const PLAN_PATH = path.join(__dirname, "data", "customer-name-guesses.json");
const BATCH_SIZE = 400;

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const execute = !!args.execute;
  const db = getFirestoreFor(projectId);

  const plan = JSON.parse(fs.readFileSync(PLAN_PATH, "utf8"));
  console.log(`${execute ? "LIVE RUN" : "DRY RUN"} against "${projectId}" - ${plan.length} planned records\n`);

  const writes = [];
  const skipped = { missing: 0, emailMismatch: 0, alreadyNamed: 0 };

  for (const entry of plan) {
    const snap = await tenantCollection(db, "customers").doc(entry.id).get();
    if (!snap.exists) {
      skipped.missing++;
      console.log(`skip ${entry.email} - doc ${entry.id} no longer exists`);
      continue;
    }
    const data = snap.data();
    if ((data.email || "").trim().toLowerCase() !== entry.email.toLowerCase()) {
      skipped.emailMismatch++;
      console.log(`skip ${entry.email} - doc ${entry.id} now holds "${data.email || ""}"`);
      continue;
    }
    if (!blank(data.firstName) || !blank(data.lastName)) {
      skipped.alreadyNamed++;
      const existing = [data.firstName || "", data.lastName || ""].filter(Boolean).join(" ").trim();
      console.log(`skip ${entry.email} - already named "${existing}"`);
      continue;
    }

    const update = {};
    if (entry.firstName) update.firstName = entry.firstName;
    if (entry.lastName) update.lastName = entry.lastName;
    if (!Object.keys(update).length) continue;

    writes.push({ ref: snap.ref, update, entry });
    const shown = [update.firstName || "", update.lastName || ""].filter(Boolean).join(" ");
    console.log(`${execute ? "set " : "would set "}${entry.email} -> ${shown}  [${entry.kind}: ${entry.basis}]`);
  }

  if (execute) {
    for (let i = 0; i < writes.length; i += BATCH_SIZE) {
      const batch = db.batch();
      writes.slice(i, i + BATCH_SIZE).forEach((w) => batch.update(w.ref, w.update));
      await batch.commit();
    }
  }

  const persons = writes.filter((w) => w.entry.kind === "person").length;
  console.log(
    `\ndone - ${writes.length} of ${plan.length} ${execute ? "updated" : "would change"} ` +
    `(${persons} person, ${writes.length - persons} organization); skipped ` +
    `${skipped.alreadyNamed} already named, ${skipped.emailMismatch} email changed, ${skipped.missing} missing`
  );
  if (!execute) console.log("Dry run only - re-run with --execute to write.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
