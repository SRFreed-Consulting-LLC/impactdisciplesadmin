#!/usr/bin/env node
// Ad-hoc, read-only: for a handful of purchases doc ids that promote.js
// flagged as conflicting, print exactly which fields differ between dev and
// prod (after the same ignore-list promote.js itself applies), so a human
// can see the *nature* of the conflicts before deciding whether to
// --force-conflicts, hand-pick some, or leave prod alone.
const { getFirestoreFor } = require("./lib/firestore-admin");
const { toPortable } = require("./lib/firestore-json");
const { NEVER_OVERWRITE_FIELDS } = require("./lib/protected-fields");

const IGNORED_FIELDS = ["_dataOps", "newRecordStatus", "fulfillmentStatus", ...NEVER_OVERWRITE_FIELDS];

function stripIgnored(data) {
  const out = { ...data };
  for (const f of IGNORED_FIELDS) delete out[f];
  return out;
}

async function main() {
  const ids = process.argv.slice(2);
  if (!ids.length) {
    console.error("Usage: node scripts/diff-purchase-conflicts.js <docId> [docId...]");
    process.exit(1);
  }

  const devDb = getFirestoreFor("impactdisciplesdev");
  const prodDb = getFirestoreFor("impactdisciples-a82a8");

  for (const id of ids) {
    const [devSnap, prodSnap] = await Promise.all([
      devDb.collection("purchases").doc(id).get(),
      prodDb.collection("purchases").doc(id).get(),
    ]);
    console.log(`\n=== ${id} ===`);
    if (!devSnap.exists || !prodSnap.exists) {
      console.log(`  dev exists=${devSnap.exists} prod exists=${prodSnap.exists}`);
      continue;
    }
    const dev = toPortable(stripIgnored(devSnap.data()));
    const prod = toPortable(stripIgnored(prodSnap.data()));
    const keys = new Set([...Object.keys(dev), ...Object.keys(prod)]);
    for (const k of keys) {
      const dv = JSON.stringify(dev[k]);
      const pv = JSON.stringify(prod[k]);
      if (dv !== pv) {
        console.log(`  ${k}:`);
        console.log(`    dev:  ${dv}`);
        console.log(`    prod: ${pv}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
