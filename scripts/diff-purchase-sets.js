#!/usr/bin/env node
// Ad-hoc, read-only: set difference of purchases doc ids between dev and
// prod, both directions (promote.js only ever looks at dev->prod).
const { getFirestoreFor } = require("./lib/firestore-admin");

async function main() {
  const devDb = getFirestoreFor("impactdisciplesdev");
  const prodDb = getFirestoreFor("impactdisciples-a82a8");

  const [devRefs, prodRefs] = await Promise.all([
    devDb.collection("purchases").listDocuments(),
    prodDb.collection("purchases").listDocuments(),
  ]);
  const devIds = new Set(devRefs.map((r) => r.id));
  const prodIds = new Set(prodRefs.map((r) => r.id));

  const devOnly = [...devIds].filter((id) => !prodIds.has(id));
  const prodOnly = [...prodIds].filter((id) => !devIds.has(id));

  console.log(`dev-only (${devOnly.length}):`, devOnly.join(", "));
  console.log(`prod-only (${prodOnly.length}):`, prodOnly.join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
