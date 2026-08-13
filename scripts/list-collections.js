#!/usr/bin/env node
// Ad-hoc, read-only: list collection names + doc counts in dev and prod
// side by side. Not part of the committed scripts/ suite - scratch tool for
// planning the dev->prod promotion table-by-table.
const { getFirestoreFor } = require("./lib/firestore-admin");

async function countAndList(db) {
  const cols = await db.listCollections();
  const out = {};
  for (const col of cols) {
    const snap = await col.count().get();
    out[col.id] = snap.data().count;
  }
  return out;
}

async function main() {
  const devDb = getFirestoreFor("impactdisciplesdev");
  const prodDb = getFirestoreFor("impactdisciples-a82a8");

  const [dev, prod] = await Promise.all([countAndList(devDb), countAndList(prodDb)]);

  const allNames = Array.from(new Set([...Object.keys(dev), ...Object.keys(prod)])).sort();
  console.log("collection,dev_count,prod_count");
  for (const name of allNames) {
    console.log(`${name},${dev[name] ?? "-"},${prod[name] ?? "-"}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
