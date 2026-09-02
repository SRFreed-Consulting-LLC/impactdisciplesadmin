#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// READ-ONLY: the Amazon Shipping Confirmation template, in full.
const { resolveProjectId, getFirestoreFor } = require("./lib/firestore-admin");
(async () => {
  const project = resolveProjectId(process.argv[2]);
  const db = getFirestoreFor(project);
  const snap = await tenantCollection(db, "mail_templates").where("name", "==", "Amazon Shipping Confirmation").get();
  console.log(`${project}: ${snap.size} match(es)`);
  snap.forEach((d) => {
    const t = d.data();
    console.log(`  id       : ${d.id}`);
    console.log(`  fields   : ${Object.keys(t).sort().join(", ")}`);
    console.log(`  kind     : ${JSON.stringify(t.kind)}`);
    console.log(`  isSystem : ${JSON.stringify(t.isSystem)}`);
    console.log(`  subject  : ${JSON.stringify(t.subject)}`);
    console.log(`  has design (builder) : ${!!t.design}`);
    console.log(`  merge tags: ${[...new Set(String(t.html ?? "").match(/\*\|[^|]+\|\*/g) ?? [])].join("  ")}`);
    console.log("  ---- html ----");
    console.log(String(t.html ?? "").replace(/></g, ">\n<"));
  });
})().catch((e) => { console.error(e); process.exit(1); });
