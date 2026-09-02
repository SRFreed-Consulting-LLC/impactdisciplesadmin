#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// One-time backfill for the "customers" collection from "event-registrations"
// - the event-registration counterpart to backfill-customers-from-purchases.js,
// mirroring functions/src/event-registration-customer-upsert.functions.ts's
// exact logic (a separate plain-JS implementation - Cloud Functions and the
// scripts/ tools run in different toolchains, there's no single module both
// could import).
//
// Registrations only ever carry firstName/lastName/email - no phone, no
// address - so this only ever resolves those two name fields (unlike the
// purchase backfill's five). Same rules: oldest-first, so history plays
// out the way it would have if the trigger had existed since day one; a
// field that's empty on file gets filled in directly (not a conflict); a
// field that's genuinely different (after name normalization - case,
// whitespace, accents) gets queued as a PendingCustomerChange instead of
// silently overwritten.
//
// Run backfill-customers-from-purchases.js FIRST if you haven't already -
// this reads the "customers" collection as it exists right now, so running
// registrations first and purchases second (or vice versa) both work, but
// running them in the same order you'll want them to have happened
// historically (purchases and registrations interleaved by date would be
// more accurate than one full collection then the other) is intentionally
// NOT what this does - each script only orders WITHIN its own source. Two
// people who both later turn out to be the same customer, one first seen
// via a purchase and again via a registration, will only get a
// PendingCustomerChange if their info genuinely differs between the two;
// most of the time this is a non-issue since the same-email match already
// finds the existing record regardless of which source ran first.
//
// Dry-run by default - reports counts and sample fills/flags without
// writing anything. Pass --execute to actually write. --project=dev|prod
// is required, no default (see lib/firestore-admin.js).
//
// Usage:
//   node scripts/backfill-customers-from-event-registrations.js --project=dev
//   node scripts/backfill-customers-from-event-registrations.js --project=dev --execute

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

function toMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.seconds === "number") return ts.seconds * 1000;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

// Trim + lowercase + diacritics stripped - see
// customer-match.functions.ts's own comment for why.
function normalizedName(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase().normalize("NFD");
  return normalized.replace(/\p{Diacritic}/gu, "");
}

function formatValue(value) {
  return value || "(none)";
}

// Deliberately loose "is this even shaped like an email" check - not full
// RFC validation, just enough to reject obvious garbage before it creates
// a customer record. See backfill-customers-from-purchases.js's own
// comment for the live-diagnosed reason this exists.
function isPlausibleEmail(rawValue) {
  if (typeof rawValue !== "string") return false;
  const value = rawValue.trim();
  const at = value.indexOf("@");
  return at > 0 && at < value.length - 1 && value.includes(".", at);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const execute = !!args.execute;
  const db = getFirestoreFor(projectId);

  console.log(`${execute ? "LIVE RUN" : "DRY RUN"} against "${projectId}"\n`);

  const existingSnap = await tenantCollection(db, "customers").get();
  const byEmail = new Map();
  existingSnap.docs.forEach((doc) => {
    const data = doc.data();
    const email = (data.email || "").trim().toLowerCase();
    if (email) byEmail.set(email, { ...data, __id: doc.id, __existed: true });
  });

  const regSnap = await tenantCollection(db, "event-registrations").get();
  const allRegs = regSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const regs = allRegs
    .filter((r) => isPlausibleEmail(r.email))
    .sort((a, b) => toMillis(a.registrationDate) - toMillis(b.registrationDate));

  const skippedNoEmail = allRegs.length - regs.length;
  console.log(`${allRegs.length} total event-registrations (${skippedNoEmail} skipped - no email), processing ${regs.length} oldest-first\n`);

  let created = 0;
  let filledCount = 0;
  const filledFieldCounts = { firstName: 0, lastName: 0 };
  const fieldFlagCounts = { firstName: 0, lastName: 0 };
  const sampleFlags = [];
  const sampleFills = [];

  for (const reg of regs) {
    const email = reg.email.trim().toLowerCase();

    let customer = byEmail.get(email);
    if (!customer) {
      customer = {
        firstName: reg.firstName || "",
        lastName: reg.lastName || "",
        email,
        role: "Customer",
        notes: [],
        pendingChanges: [],
        __new: true
      };
      byEmail.set(email, customer);
      created++;
      continue;
    }

    customer.pendingChanges = customer.pendingChanges || [];

    const flagChange = (field, currentValue, proposedValue) => {
      const entry = { field, currentValue: currentValue ?? null, proposedValue, source: "eventRegistration", sourceId: reg.id, detectedDate: reg.registrationDate || null };
      const idx = customer.pendingChanges.findIndex((p) => p.field === field);
      if (idx >= 0) customer.pendingChanges[idx] = entry;
      else customer.pendingChanges.push(entry);
      customer.__dirty = true;
      fieldFlagCounts[field]++;
      if (sampleFlags.length < 15) {
        sampleFlags.push({ email, field, current: formatValue(currentValue), proposed: formatValue(proposedValue) });
      }
    };

    const fillField = (field, value) => {
      customer[field] = value;
      customer.__dirty = true;
      filledCount++;
      filledFieldCounts[field]++;
      if (sampleFills.length < 10) {
        sampleFills.push({ email, field, filled: formatValue(value) });
      }
    };

    const resolveNameField = (field, proposedRaw) => {
      const proposed = typeof proposedRaw === "string" ? proposedRaw.trim() : "";
      if (!proposed) return;
      const currentValue = customer[field];
      if (!normalizedName(currentValue)) {
        fillField(field, proposed);
        return;
      }
      if (normalizedName(currentValue) === normalizedName(proposed)) return;
      flagChange(field, currentValue, proposed);
    };

    resolveNameField("firstName", reg.firstName);
    resolveNameField("lastName", reg.lastName);
  }

  const dirtyExisting = [...byEmail.values()].filter((c) => c.__existed && c.__dirty);
  const totalFlags = Object.values(fieldFlagCounts).reduce((a, b) => a + b, 0);

  console.log(`${existingSnap.size} customers currently in Firestore`);
  console.log(`${created} NEW customer record(s) would be created`);
  console.log(`${filledCount} gap(s) would be silently filled in (field was empty, registration had a value - not a conflict):`);
  for (const [field, count] of Object.entries(filledFieldCounts)) {
    if (count > 0) console.log(`  ${field}: ${count}`);
  }
  console.log(`${dirtyExisting.length} EXISTING customer(s) would get pending-review flags (${totalFlags} total field flags):`);
  for (const [field, count] of Object.entries(fieldFlagCounts)) {
    if (count > 0) console.log(`  ${field}: ${count}`);
  }
  console.log("");

  if (sampleFills.length > 0) {
    console.log(`Sample fills (first ${sampleFills.length}):`);
    for (const s of sampleFills) {
      console.log(`  [${s.email}] ${s.field}: (none) -> "${s.filled}"`);
    }
    console.log("");
  }

  if (sampleFlags.length > 0) {
    console.log(`Sample flags (first ${sampleFlags.length}):`);
    for (const s of sampleFlags) {
      console.log(`  [${s.email}] ${s.field}: "${s.current}" -> "${s.proposed}"`);
    }
    console.log("");
  }

  if (!execute) {
    console.log("Dry run only - re-run with --execute to write.");
    return;
  }

  const toWrite = [...byEmail.values()].filter((c) => c.__new || c.__dirty);
  console.log(`Writing ${toWrite.length} customer record(s)...`);

  let batch = db.batch();
  let opsInBatch = 0;
  let batchesFlushed = 0;

  for (const c of toWrite) {
    const clean = { ...c };
    delete clean.__id;
    delete clean.__existed;
    delete clean.__new;
    delete clean.__dirty;

    if (c.__new) {
      const ref = tenantCollection(db, "customers").doc();
      batch.set(ref, clean);
    } else {
      const ref = tenantCollection(db, "customers").doc(c.__id);
      // Only firstName/lastName/pendingChanges can ever have changed here -
      // registrations never touch phone/address.
      batch.update(ref, {
        firstName: clean.firstName,
        lastName: clean.lastName,
        pendingChanges: clean.pendingChanges
      });
    }

    opsInBatch++;
    if (opsInBatch >= 400) {
      await batch.commit();
      batchesFlushed++;
      batch = db.batch();
      opsInBatch = 0;
    }
  }
  if (opsInBatch > 0) {
    await batch.commit();
    batchesFlushed++;
  }

  console.log(`Done - ${batchesFlushed} batch(es) committed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
