#!/usr/bin/env node
// One-off, 2026-09-03: the four Impact Discipleship digital products carry
// "Download andd Install ..." in their description. It shows on the reader's
// Store screen (and so in the marketing still of it). Fix the word.
//
// Scans EVERY string field of every product doc for the whole word "andd"
// (case-insensitive) rather than naming the field, so a second copy of the
// typo in a summary or subtitle is caught too. Dry run by default; --apply
// writes. Idempotent.
//
//   node scripts/fix-products-andd-typo.js --project=dev
//   node scripts/fix-products-andd-typo.js --project=dev --apply
//   node scripts/fix-products-andd-typo.js --project=prod --apply

const {resolveProjectId, getFirestoreFor} = require("./lib/firestore-admin");
const {tenantPath} = require("./lib/tenancy");

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const APPLY = process.argv.includes("--apply");
const TYPO = /\bandd\b/gi;

/** Walks a plain object, fixing string leaves in place; returns the paths
 *  it changed. */
function fix(value, path, changed) {
  if (typeof value === "string") {
    if (!TYPO.test(value)) return value;
    TYPO.lastIndex = 0;
    const next = value.replace(TYPO, (m) => (m[0] === "A" ? "And" : "and"));
    changed.push(`${path}: ${JSON.stringify(value)} -> ${JSON.stringify(next)}`);
    return next;
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => fix(v, `${path}[${i}]`, changed));
  }
  if (value && typeof value === "object" && value.constructor === Object) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = fix(v, path ? `${path}.${k}` : k, changed);
    }
    return out;
  }
  return value; // Timestamps, refs, numbers, booleans - untouched
}

async function main() {
  const projectId = resolveProjectId(arg("project"));
  const db = getFirestoreFor(projectId);
  const snap = await db.collection(tenantPath("products")).get();
  console.log(`${projectId}: ${snap.size} products`);

  let pending = 0;
  const batch = db.batch();
  for (const doc of snap.docs) {
    const changed = [];
    const fixed = fix(doc.data(), "", changed);
    if (!changed.length) continue;
    console.log(`  ${doc.id} (${doc.get("title")})`);
    for (const c of changed) console.log(`    ${c}`);
    batch.set(doc.ref, fixed);
    pending += 1;
  }

  if (!pending) {
    console.log("Nothing to fix.");
    return;
  }
  if (!APPLY) {
    console.log(`\nDRY RUN - ${pending} doc(s) NOT written. Re-run with --apply.`);
    return;
  }
  await batch.commit();
  console.log(`\nWrote ${pending} doc(s).`);
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exitCode = 1;
});
