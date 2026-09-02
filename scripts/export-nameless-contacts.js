#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// Exports every `customers` record with NO firstName and NO lastName, and
// reports what else in the database points at them - so a decision to delete
// is made with the consequences visible rather than on a count.
//
// READ-ONLY. Deleting is a separate script on purpose; this one cannot.
//
//   node scripts/export-nameless-contacts.js --project=prod
//   node scripts/export-nameless-contacts.js --project=prod --out=path.json
"use strict";

const fs = require("fs");
const path = require("path");
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

/** Firestore's `in` takes 30 values per query. */
function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const db = getFirestoreFor(projectId);

  const snap = await tenantCollection(db, "customers").get();
  const nameless = [];
  let total = 0;
  snap.forEach((d) => {
    total++;
    const c = d.data();
    // NO LAST NAME is the test - a first name alone is not an identity you
    // can address, and these records came from a mailing-list import that
    // only ever had an email. Widened from "neither name" on 2026-08-27.
    if (blank(c.lastName)) {
      nameless.push({ id: d.id, ...c });
    }
  });

  console.log(`${projectId}`);
  console.log(`  customers total .................. ${total}`);
  console.log(`  no lastName ...................... ${nameless.length}`);
  console.log(`     ...of those, also no firstName  ${nameless.filter((c) => blank(c.firstName)).length}`);

  const emails = nameless.map((c) => (c.email || "").trim().toLowerCase()).filter(Boolean);
  const withoutEmail = nameless.length - emails.length;

  // ---- what would be lost -------------------------------------------------
  const subscribers = nameless.filter((c) => c.subscribedToNewsletter || c.subscribedToPrayerTeam);
  const tagged = nameless.filter((c) => (c.tags ?? []).length > 0);
  const withOrg = nameless.filter((c) => !!c.organizationId);
  const withPhone = nameless.filter((c) => !!c.phone?.number);
  const withNotes = nameless.filter((c) => (c.notes ?? []).length > 0);
  const withPending = nameless.filter((c) => (c.pendingChanges ?? []).length > 0);

  // Purchases and registrations are keyed by email, not by customer id.
  const purchaseCounts = new Map();
  const registrationCounts = new Map();
  for (const group of chunk(emails, 30)) {
    for (const [coll, field, target] of [
      ["purchases", "email", purchaseCounts],
      ["event-registrations", "email", registrationCounts],
    ]) {
      const q = await db.collection(coll).where(field, "in", group).get();
      q.forEach((d) => {
        const e = (d.data()[field] || "").trim().toLowerCase();
        target.set(e, (target.get(e) ?? 0) + 1);
      });
    }
  }

  const withPurchases = emails.filter((e) => purchaseCounts.has(e));
  const withRegistrations = emails.filter((e) => registrationCounts.has(e));

  console.log("");
  console.log("  Of those, how many carry something a deletion would destroy:");
  console.log(`    no email address at all ........ ${withoutEmail}`);
  console.log(`    newsletter / prayer subscriber . ${subscribers.length}`);
  console.log(`    has purchases .................. ${withPurchases.length}`);
  console.log(`    has event registrations ........ ${withRegistrations.length}`);
  console.log(`    has tags ....................... ${tagged.length}`);
  console.log(`    linked to an organization ...... ${withOrg.length}`);
  console.log(`    has a phone number ............. ${withPhone.length}`);
  console.log(`    has staff notes ................ ${withNotes.length}`);
  console.log(`    has unresolved pending changes . ${withPending.length}`);

  // THE DELETION RULE (owner, 2026-08-27): no last name, never bought
  // anything, never attended an event. A newsletter subscription does NOT
  // protect a record - being on a mailing list is not a relationship with a
  // person whose name we do not have.
  const untouched = nameless.filter((c) => {
    const e = (c.email || "").trim().toLowerCase();
    return !purchaseCounts.has(e) && !registrationCounts.has(e);
  });
  console.log("");
  console.log(`  DELETABLE - no last name, no purchase, no event: ${untouched.length} of ${nameless.length}`);
  console.log(`  KEPT because they bought or attended ..........: ${nameless.length - untouched.length}`);

  // ---- write the export ---------------------------------------------------
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = args.out || path.join(__dirname, "output", `nameless-contacts-${projectId}-${stamp}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const payload = nameless.map((c) => {
    const e = (c.email || "").trim().toLowerCase();
    return {
      ...c,
      _purchases: purchaseCounts.get(e) ?? 0,
      _registrations: registrationCounts.get(e) ?? 0,
      _safeToDelete: untouched.some((u) => u.id === c.id),
    };
  });
  fs.writeFileSync(outPath, JSON.stringify({
    project: projectId,
    exportedAt: new Date().toISOString(),
    customersTotal: total,
    namelessCount: nameless.length,
    records: payload,
  }, null, 2), "utf8");

  // A CSV alongside it, because a spreadsheet is what someone actually opens.
  const csvPath = outPath.replace(/\.json$/, ".csv");
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["id", "email", "phone", "subscribedNewsletter", "subscribedPrayerTeam",
    "tags", "organizationId", "purchases", "registrations", "safeToDelete"].join(",")];
  for (const c of payload) {
    rows.push([c.id, c.email, c.phone?.number, c.subscribedToNewsletter === true,
      c.subscribedToPrayerTeam === true, (c.tags ?? []).join(" "), c.organizationId,
      c._purchases, c._registrations, c._safeToDelete].map(esc).join(","));
  }
  fs.writeFileSync(csvPath, rows.join("\n"), "utf8");

  console.log("");
  console.log(`  JSON: ${outPath}`);
  console.log(`  CSV : ${csvPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
