#!/usr/bin/env node
const {tenantCollection} = require("./lib/tenancy");
// READ-ONLY: how often does an Amazon shipping confirmation carry a tracking
// number? amazonTracking is written only by sendAmazonConfirmation(), so its
// presence is a direct record of whether the dialog's optional field was used.
const { resolveProjectId, getFirestoreFor } = require("./lib/firestore-admin");

const has = (v) => typeof v === "string" && v.trim() !== "";

(async () => {
  const projectId = resolveProjectId(process.argv[2]);
  const db = getFirestoreFor(projectId);

  const rows = [];
  (await tenantCollection(db, "purchases").get()).forEach((d) => rows.push({ id: d.id, ...d.data() }));

  // An order that went down the Amazon path has the field present at all -
  // sendAmazonConfirmation writes `amazonTracking: value || null`, so a null
  // means "Amazon button pressed, box left blank" and absent means "never
  // went through that path".
  const touched = rows.filter((r) => Object.prototype.hasOwnProperty.call(r, "amazonTracking"));
  const withTracking = touched.filter((r) => has(r.amazonTracking));
  const blank = touched.filter((r) => !has(r.amazonTracking));

  console.log(`${projectId}`);
  console.log(`  purchases total .......................... ${rows.length}`);
  console.log(`  Amazon confirmations sent ................ ${touched.length}`);
  console.log(`     with a tracking number ................ ${withTracking.length}`);
  console.log(`     left blank ............................ ${blank.length}`);

  if (touched.length) {
    const pct = ((withTracking.length / touched.length) * 100).toFixed(0);
    console.log(`     -> the field is filled in ${pct}% of the time`);
  }

  if (withTracking.length) {
    console.log("\n  the ones that do have it:");
    withTracking.slice(0, 10).forEach((r) =>
      console.log(`     ${String(r.email ?? "").padEnd(34)} ${String(r.amazonTracking).slice(0, 40)}`));
  }

  // Cross-check against fulfilment state, so "closed" orders that never used
  // the Amazon path are not counted as blanks.
  const closed = rows.filter((r) => r.fulfillmentStatus === "closed");
  console.log(`\n  closed orders (any path) ................. ${closed.length}`);
  console.log(`  closed WITHOUT ever touching the Amazon path: ${closed.filter((r) => !Object.prototype.hasOwnProperty.call(r, "amazonTracking")).length}`);
})().catch((e) => { console.error(e); process.exit(1); });
