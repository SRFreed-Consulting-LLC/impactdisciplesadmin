#!/usr/bin/env node
// Merges the "safe" duplicate "customers" records found by
// inspect-duplicate-customers.js: docs that share
// the same email AND the same normalized name (exact copies, or copies that
// only differ in a field that was empty on one side). Docs on the same
// email but with genuinely DIFFERENT names are left completely untouched -
// those need a human to look at them (see inspect-duplicate-customers.js's
// own "different names" sample output), never auto-merged.
//
// For each safe group:
//   1. Pick a survivor - whichever doc scores highest on (has an address on
//      file ? 1 : 0) + pendingChanges.length, tie-broken by doc id for
//      determinism.
//   2. Fill any of the survivor's empty fields (firstName/lastName/phone/
//      shippingAddress/billingAddress) from another doc in the group that
//      has a value - no real data is thrown away just because it happened
//      to live on the doc that isn't kept.
//   3. Merge notes (concat, dedupe by note id) and pendingChanges (concat,
//      dedupe by field, keeping the most recent detectedDate per field).
//   4. Delete every other doc in the group.
//
// Dry-run by default - reports what would happen without writing/deleting
// anything. Pass --execute to actually write. --project=dev|prod required,
// no default (see lib/firestore-admin.js).
//
// Usage:
//   node scripts/merge-duplicate-customers.js --project=dev
//   node scripts/merge-duplicate-customers.js --project=dev --execute

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

function normalizedName(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function fmtAddr(a) {
  if (!a || !a.address1) return "(none)";
  return [a.address1, [a.city, a.state, a.zip].filter(Boolean).join(", ")].filter(Boolean).join(", ");
}

function score(doc) {
  return (doc.shippingAddress && doc.shippingAddress.address1 ? 1 : 0) + (doc.pendingChanges ? doc.pendingChanges.length : 0);
}

function mergePendingChanges(groups) {
  const byField = new Map();
  for (const list of groups) {
    for (const entry of list || []) {
      const existing = byField.get(entry.field);
      const entryMillis = entry.detectedDate && entry.detectedDate.toMillis ? entry.detectedDate.toMillis() : 0;
      const existingMillis = existing && existing.detectedDate && existing.detectedDate.toMillis ? existing.detectedDate.toMillis() : -1;
      if (!existing || entryMillis > existingMillis) byField.set(entry.field, entry);
    }
  }
  return [...byField.values()];
}

function mergeNotes(groups) {
  const byId = new Map();
  for (const list of groups) {
    for (const note of list || []) {
      if (note.id) byId.set(note.id, note);
    }
  }
  return [...byId.values()];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const execute = !!args.execute;
  const db = getFirestoreFor(projectId);

  console.log(`${execute ? "LIVE RUN" : "DRY RUN"} against "${projectId}"\n`);

  const customersSnap = await db.collection("customers").get();
  const byEmail = new Map();
  customersSnap.docs.forEach((doc) => {
    const data = doc.data();
    const email = (data.email || "").trim().toLowerCase();
    if (!email) return;
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email).push({ id: doc.id, ...data });
  });

  const duplicateGroups = [...byEmail.entries()].filter(([, docs]) => docs.length > 1);

  let safeGroups = 0;
  let ambiguousGroups = 0;
  let docsDeleted = 0;
  let fieldsBackfilled = 0;
  const plan = [];

  for (const [email, docs] of duplicateGroups) {
    const names = new Set(docs.map((d) => `${normalizedName(d.firstName)} ${normalizedName(d.lastName)}`.trim()));
    if (names.size > 1) {
      ambiguousGroups++;
      continue;
    }
    safeGroups++;

    const sorted = [...docs].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
    const survivor = { ...sorted[0] };
    const losers = sorted.slice(1);

    const fills = [];
    for (const field of ["firstName", "lastName"]) {
      if (!survivor[field]) {
        const donor = losers.find((l) => l[field]);
        if (donor) {
          survivor[field] = donor[field];
          fills.push(`${field}: "${donor[field]}"`);
          fieldsBackfilled++;
        }
      }
    }
    if (!survivor.phone || !survivor.phone.number) {
      const donor = losers.find((l) => l.phone && l.phone.number);
      if (donor) {
        survivor.phone = donor.phone;
        fills.push(`phone: "${donor.phone.number}"`);
        fieldsBackfilled++;
      }
    }
    if (!survivor.shippingAddress || !survivor.shippingAddress.address1) {
      const donor = losers.find((l) => l.shippingAddress && l.shippingAddress.address1);
      if (donor) {
        survivor.shippingAddress = donor.shippingAddress;
        fills.push(`shippingAddress: "${fmtAddr(donor.shippingAddress)}"`);
        fieldsBackfilled++;
      }
    }
    if (!survivor.billingAddress || !survivor.billingAddress.address1) {
      const donor = losers.find((l) => l.billingAddress && l.billingAddress.address1);
      if (donor) {
        survivor.billingAddress = donor.billingAddress;
        fills.push(`billingAddress: "${fmtAddr(donor.billingAddress)}"`);
        fieldsBackfilled++;
      }
    }

    survivor.notes = mergeNotes([survivor.notes, ...losers.map((l) => l.notes)]);
    survivor.pendingChanges = mergePendingChanges([survivor.pendingChanges, ...losers.map((l) => l.pendingChanges)]);

    docsDeleted += losers.length;
    plan.push({ email, survivorId: survivor.id, survivor, loserIds: losers.map((l) => l.id), fills });
  }

  console.log(`${duplicateGroups.length} duplicate-email groups found`);
  console.log(`  ${safeGroups} safe (same name across all docs) - will be merged`);
  console.log(`  ${ambiguousGroups} ambiguous (different names) - left untouched, not part of this script\n`);
  console.log(`Plan: keep ${safeGroups} customer doc(s), delete ${docsDeleted} redundant doc(s), backfill ${fieldsBackfilled} gap field(s)\n`);

  console.log("Sample merges (first 10):");
  for (const p of plan.slice(0, 10)) {
    console.log(`  ${p.email}: keep ${p.survivorId}, delete [${p.loserIds.join(", ")}]${p.fills.length ? " - filled " + p.fills.join(", ") : ""}`);
  }
  console.log("");

  if (!execute) {
    console.log("Dry run only - re-run with --execute to write.");
    return;
  }

  console.log(`Writing ${plan.length} survivor updates + ${docsDeleted} deletes...`);
  let batch = db.batch();
  let opsInBatch = 0;
  let batchesFlushed = 0;

  const flush = async () => {
    if (opsInBatch > 0) {
      await batch.commit();
      batchesFlushed++;
      batch = db.batch();
      opsInBatch = 0;
    }
  };

  for (const p of plan) {
    const clean = { ...p.survivor };
    delete clean.id;
    batch.update(db.collection("customers").doc(p.survivorId), clean);
    opsInBatch++;
    if (opsInBatch >= 400) await flush();

    for (const loserId of p.loserIds) {
      batch.delete(db.collection("customers").doc(loserId));
      opsInBatch++;
      if (opsInBatch >= 400) await flush();
    }
  }
  await flush();

  console.log(`Done - ${batchesFlushed} batch(es) committed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
