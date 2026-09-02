#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// Read-only inspection of the duplicate-email customer records flagged by
// backfill-customers-from-purchases.js's dry-run - for the "what should we
// actually do about these" conversation, not for fixing anything itself.
//
// For each email with >1 customers doc, reports: how many docs, how much
// each differs (name/phone/address), whether purchases exist under that
// email at all (i.e. did a real order ever happen, or is this dead data
// from manual entry only), and a rough classification guess (exact
// duplicate / same-person-more-info / looks-like-different-people).
//
// Usage:
//   node scripts/inspect-duplicate-customers.js --project=dev

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

function normalizedPhoneDigits(value) {
  const digits = (value || "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function fmtAddr(a) {
  if (!a || !a.address1) return "(none)";
  return [a.address1, [a.city, a.state, a.zip].filter(Boolean).join(", ")].filter(Boolean).join(", ");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const db = getFirestoreFor(projectId);

  console.log(`Inspecting duplicate customer emails in "${projectId}"\n`);

  const customersSnap = await tenantCollection(db, "customers").get();
  const byEmail = new Map();
  customersSnap.docs.forEach((doc) => {
    const data = doc.data();
    const email = (data.email || "").trim().toLowerCase();
    if (!email) return;
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email).push({ id: doc.id, ...data });
  });

  const duplicates = [...byEmail.entries()].filter(([, docs]) => docs.length > 1);
  console.log(`${duplicates.length} email(s) with more than one customer doc\n`);

  const purchasesSnap = await tenantCollection(db, "purchases").get();
  const purchaseCountByEmail = new Map();
  purchasesSnap.docs.forEach((doc) => {
    const email = (doc.data().email || "").trim().toLowerCase();
    if (!email) return;
    purchaseCountByEmail.set(email, (purchaseCountByEmail.get(email) || 0) + 1);
  });

  let exactDupes = 0;
  let sameNameDifferentInfo = 0;
  let differentNames = 0;
  let noPurchasesAtAll = 0;
  const differentNameSamples = [];
  const noPurchaseSamples = [];

  for (const [email, docs] of duplicates) {
    const purchaseCount = purchaseCountByEmail.get(email) || 0;
    if (purchaseCount === 0) {
      noPurchasesAtAll++;
      if (noPurchaseSamples.length < 8) noPurchaseSamples.push({ email, count: docs.length });
    }

    const names = new Set(docs.map((d) => `${normalizedName(d.firstName)} ${normalizedName(d.lastName)}`.trim()));
    const phones = new Set(docs.map((d) => normalizedPhoneDigits(d.phone && d.phone.number)).filter(Boolean));
    const addrs = new Set(docs.map((d) => fmtAddr(d.shippingAddress)));

    if (names.size <= 1 && phones.size <= 1 && addrs.size <= 1) {
      exactDupes++;
    } else if (names.size <= 1) {
      sameNameDifferentInfo++;
    } else {
      differentNames++;
      if (differentNameSamples.length < 25) {
        differentNameSamples.push({
          email,
          purchaseCount,
          docs: docs.map((d) => ({ id: d.id, name: `${d.firstName || ""} ${d.lastName || ""}`.trim(), phone: d.phone?.number || "(none)" }))
        });
      }
    }
  }

  console.log(`Classification of the ${duplicates.length} duplicate emails:`);
  console.log(`  Exact duplicates (same name/phone/address, just two docs)              : ${exactDupes}`);
  console.log(`  Same name, some other field differs (phone/address updated over time)  : ${sameNameDifferentInfo}`);
  console.log(`  DIFFERENT names on the same email (possibly different people)          : ${differentNames}`);
  console.log(`  Have ZERO purchases under this email at all (pure manual-entry dupes)  : ${noPurchasesAtAll}`);
  console.log("");

  if (differentNameSamples.length > 0) {
    console.log(`Sample "different names, same email" cases (first ${differentNameSamples.length}):`);
    for (const s of differentNameSamples) {
      console.log(`  ${s.email} (${s.purchaseCount} purchase(s) on file):`);
      for (const d of s.docs) {
        console.log(`    ${d.id}: "${d.name}" - ${d.phone}`);
      }
    }
    console.log("");
  }

  if (noPurchaseSamples.length > 0) {
    console.log(`Sample "zero purchases, pure manual duplicate" cases (first ${noPurchaseSamples.length}):`);
    for (const s of noPurchaseSamples) {
      console.log(`  ${s.email}: ${s.count} docs, 0 purchases`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
