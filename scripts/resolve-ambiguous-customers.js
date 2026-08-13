#!/usr/bin/env node
// Applies the 25 human decisions made interactively (see the session that
// produced this file) for the "different names, same email" duplicates
// inspect-duplicate-customers.js/merge-duplicate-customers.js deliberately
// left untouched. Each entry below is DECISIONS[email] = docIdToKeep - the
// admin picked which identity is correct; this script does the mechanical
// work merge-duplicate-customers.js already does for the "safe" cases:
// fill the survivor's empty fields from the loser(s), merge notes/
// pendingChanges, then delete the loser(s).
//
// One-time, hand-curated - NOT meant to be re-run against a different
// project's data (the doc ids below are specific to the dev customers
// collection as it existed at merge time). Re-running after those docs no
// longer exist is a silent no-op per email (see the "not found" skip
// below), not an error.
//
// Dry-run by default. Pass --execute to actually write/delete.
// --project=dev|prod required, no default (see lib/firestore-admin.js).
//
// Usage:
//   node scripts/resolve-ambiguous-customers.js --project=dev
//   node scripts/resolve-ambiguous-customers.js --project=dev --execute

const { resolveProjectId, getFirestoreFor } = require("./lib/firestore-admin");

// email -> { keep: docId, note?: string }
// note is set only where the admin's answer didn't name a specific record
// (both sides were equally blank) - the survivor was picked arbitrarily.
const DECISIONS = {
  "bertchastain55@gmail.com": { keep: "CaHBpVjYr1VDW5mudgys" }, // Bert Chastain
  "admin@frbaga.org": { keep: "4fG6jHI3gxOZScNZAtp9", note: "picked arbitrarily - both sides equally blank" }, // Brenda Trice
  "melissa@tscjax.com": { keep: "4uOdjAcoOdEQgd06eIpX", note: "picked arbitrarily - both sides equally blank" }, // Paul Muzichuk
  "natashakmoses7@gmail.com": { keep: "VfXnuS6SEPUTVLHQ1YGS" }, // Natasha Moses
  "mykalola@aol.com": { keep: "8I6G11ERPI5cnI7pKaQe" }, // Gregory Horsley
  "paulv@fbcptc.org": { keep: "pV2owxHetfOfPKcWxl3R" }, // paul vasquez
  "steven.mills@northwestu.edu": { keep: "AovQOYj58fAhCtCyLvEh" }, // Steven Mills
  "jr@firstmoultrie.org": { keep: "BWTuj5OxtgHXdP0FfLGx" }, // JR Neal
  "donnie.chase@likewiseministry.com": { keep: "yo4x2BPO0FOmEGOmqGiB" }, // Donnie Chase
  "petersliz139@gmail.com": { keep: "eXw8DyduKpMNqpxv45bW" }, // Liz Peters
  "casonpreach@gmail.com": { keep: "GfMGYNqGFFsg0asiN4oG" }, // Allen Cason
  "chappy4321@hotmail.com": { keep: "O7KjvO0GRy1OcpWGg4eN" }, // Karen Chapman
  "wolfordfam@yahoo.com": { keep: "mj8Dqqy8aeEruSJPz6Nz" }, // Stephanie Wolford
  "hscottwilson@bellsouth.net": { keep: "VwOP40dSHV7Y3eOSLRsS" }, // Scott Wilson
  "gloriacann@kw.com": { keep: "LldVpH1jU7Px4bZFYBGa" }, // Gloria Schrepfer
  "thomrhyne@gmail.com": { keep: "LnO0Wl6kKjWBHrYll6tl" }, // Thomas Robinson
  "bertchastain@charter.net": { keep: "M4JrOK6ulHVFP1NA2K30", note: "picked arbitrarily - both sides equally blank" }, // Berthold Chastain
  "apostlevansk@gmail.com": { keep: "QFwoN1A1AUzWMoCr8o6x" }, // Evans Baraka
  "stanley_8@yahoo.com": { keep: "RApWYOSEGIxJJbefiizD" }, // Dawn Lane
  "lippman.bill@gmail.com": { keep: "RfJGcsiWcH77lHoSKXf3" }, // Bill Lippman
  "carlbenedict@yahoo.com": { keep: "aKvPSuhA6TPzJ8CSj4g4" }, // Carl BENEDICT
  "kw9014@gmail.com": { keep: "gwmXvWx9idA2KepGBTnt" }, // kenneth wright
  "kberkeyjr@gmail.com": { keep: "hLg8QYRyJf56pHn40aIQ" }, // Kenneth Berkey
  "elise@cultivatenext.org": { keep: "pxQW3NDEEg8VbgReY5ql" }, // Elise Kilgore
  "jgs_93@outlook.com": { keep: "o9RIKW6ilQr0ZhYcZ6ZB" } // Jake Shelton
};

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

function fmtAddr(a) {
  if (!a || !a.address1) return "(none)";
  return [a.address1, [a.city, a.state, a.zip].filter(Boolean).join(", ")].filter(Boolean).join(", ");
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

  const plan = [];
  const skipped = [];

  for (const [email, decision] of Object.entries(DECISIONS)) {
    const docs = byEmail.get(email);
    if (!docs || docs.length < 2) {
      skipped.push({ email, reason: !docs ? "no docs found" : "only 1 doc left - already resolved?" });
      continue;
    }
    const survivor = docs.find((d) => d.id === decision.keep);
    const losers = docs.filter((d) => d.id !== decision.keep);
    if (!survivor) {
      skipped.push({ email, reason: `decided doc ${decision.keep} not found among [${docs.map((d) => d.id).join(", ")}]` });
      continue;
    }

    const merged = { ...survivor };
    const fills = [];
    for (const field of ["firstName", "lastName"]) {
      if (!merged[field]) {
        const donor = losers.find((l) => l[field]);
        if (donor) { merged[field] = donor[field]; fills.push(`${field}: "${donor[field]}"`); }
      }
    }
    if (!merged.phone || !merged.phone.number) {
      const donor = losers.find((l) => l.phone && l.phone.number);
      if (donor) { merged.phone = donor.phone; fills.push(`phone: "${donor.phone.number}"`); }
    }
    if (!merged.shippingAddress || !merged.shippingAddress.address1) {
      const donor = losers.find((l) => l.shippingAddress && l.shippingAddress.address1);
      if (donor) { merged.shippingAddress = donor.shippingAddress; fills.push(`shippingAddress: "${fmtAddr(donor.shippingAddress)}"`); }
    }
    if (!merged.billingAddress || !merged.billingAddress.address1) {
      const donor = losers.find((l) => l.billingAddress && l.billingAddress.address1);
      if (donor) { merged.billingAddress = donor.billingAddress; fills.push(`billingAddress: "${fmtAddr(donor.billingAddress)}"`); }
    }
    merged.notes = mergeNotes([merged.notes, ...losers.map((l) => l.notes)]);
    merged.pendingChanges = mergePendingChanges([merged.pendingChanges, ...losers.map((l) => l.pendingChanges)]);

    plan.push({ email, note: decision.note, survivorId: survivor.id, survivorName: `${survivor.firstName || ""} ${survivor.lastName || ""}`.trim(), merged, loserIds: losers.map((l) => l.id), fills });
  }

  console.log(`${plan.length} of ${Object.keys(DECISIONS).length} decisions ready to apply\n`);
  for (const p of plan) {
    console.log(`  ${p.email}: keep "${p.survivorName}" (${p.survivorId}), delete [${p.loserIds.join(", ")}]${p.fills.length ? " - filled " + p.fills.join(", ") : ""}${p.note ? "  ** " + p.note : ""}`);
  }

  if (skipped.length > 0) {
    console.log(`\n${skipped.length} decision(s) skipped:`);
    for (const s of skipped) console.log(`  ${s.email}: ${s.reason}`);
  }

  if (!execute) {
    console.log("\nDry run only - re-run with --execute to write.");
    return;
  }

  console.log(`\nWriting ${plan.length} survivor updates + ${plan.reduce((n, p) => n + p.loserIds.length, 0)} deletes...`);
  const batch = db.batch();
  for (const p of plan) {
    const clean = { ...p.merged };
    delete clean.id;
    batch.update(db.collection("customers").doc(p.survivorId), clean);
    for (const loserId of p.loserIds) {
      batch.delete(db.collection("customers").doc(loserId));
    }
  }
  await batch.commit();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
