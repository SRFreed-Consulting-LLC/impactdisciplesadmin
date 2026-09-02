// DID THE CUTOVER LOSE ANY PRODUCTION DATA, OR IMPORT ANY DEV DATA?
//
//   node scripts/audit-prod-cutover.js --backup=<dir under scripts/backups>
//
// READ-ONLY. Answers one question, in both directions, against the snapshot
// taken of production BEFORE anything was touched:
//
//   1. IS ANYTHING MISSING? Every document production had must exist under
//      tenants/{id}, with identical fields. A migration that silently drops
//      a customer, a purchase, a patron's licence or a lesson highlight is
//      the failure that matters, and counts alone will not find it - two
//      collections can hold the same NUMBER of documents and not the same
//      documents.
//
//   2. IS ANYTHING FOREIGN? Every document now under the tenant must have
//      come from production's own snapshot. A document id that appears in
//      the nested copy but NOT in the backup came from somewhere else -
//      which, on this project, means dev. That is the direction people
//      forget to check, and it is the one that quietly replaces a real
//      customer with a test one.
//
// The five collections promoted from dev ON PURPOSE - the pages, nav and
// footer production never had - are listed below and exempted from check 2
// only. They are still checked for loss.

const fs = require("fs");
const path = require("path");
const {getFirestoreFor, resolveProjectId} = require("./lib/firestore-admin");
const {toPortable} = require("./lib/firestore-json");
const {deepEqual} = require("./lib/deep-equal");
const {TENANT_ID, TENANT_COLLECTIONS} = require("./lib/tenancy");

/** Promoted from dev deliberately: production had none of these. */
const PROMOTED = new Set([
  "page_content", "site_navigation", "site_footer",
  "popup_templates", "adminMessages",
]);

/** Bookkeeping the promotion strips, so a difference here is not a change. */
const IGNORED = ["_dataOps", "newRecordStatus", "fulfillmentStatus"];

/**
 * Strips the fields that are expected to differ, so the comparison reports
 * real divergence rather than import provenance.
 * @param {object} d A document's data.
 * @return {object} Its comparable shape.
 */
function comparable(d) {
  const out = {...toPortable(d)};
  for (const f of IGNORED) delete out[f];
  return out;
}

async function main() {
  const arg = (process.argv.find((a) => a.startsWith("--backup=")) || "")
    .split("=")[1];
  if (!arg) {
    console.error("Missing --backup=<dir name under scripts/backups>");
    process.exit(1);
  }
  const dir = path.join(__dirname, "backups", arg);
  if (!fs.existsSync(dir)) {
    console.error(`No such backup: ${dir}`);
    process.exit(1);
  }

  const db = getFirestoreFor(resolveProjectId("prod"));
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "_manifest.json");

  console.log(`Auditing production against ${arg}\n`);
  console.log("  collection                 backup     now   missing  differs  foreign");

  let tMissing = 0;
  let tDiffers = 0;
  let tForeign = 0;
  let tChecked = 0;
  const detail = [];

  for (const file of files.sort()) {
    const name = file.replace(/\.json$/, "");
    const rows = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const byId = new Map(rows.map((r) => [r.id, r.data]));

    // WHERE THIS COLLECTION IS SUPPOSED TO BE NOW. A collection that never
    // moved must still be at the top level and unchanged - checking it
    // against the tenant reports every one of its documents as "missing",
    // which is the audit lying rather than the migration failing. `courses`
    // and `e2e_runs` did exactly that on the first run.
    const moved = TENANT_COLLECTIONS.includes(name);
    const where = moved ? `tenants/${TENANT_ID}/${name}` : name;
    const snap = await db.collection(where).get();
    const nested = new Map(snap.docs.map((d) => [d.id, d.data()]));

    let missing = 0;
    let differs = 0;
    for (const [id, data] of byId) {
      tChecked++;
      if (!nested.has(id)) {
        missing++;
        if (detail.length < 40) detail.push(`MISSING  ${name}/${id}`);
        continue;
      }
      if (!deepEqual(comparable(data), comparable(nested.get(id)))) {
        differs++;
        if (detail.length < 40) detail.push(`DIFFERS  ${name}/${id}`);
      }
    }

    // Anything under the tenant that production never had.
    let foreign = 0;
    if (!PROMOTED.has(name)) {
      for (const id of nested.keys()) {
        if (!byId.has(id)) {
          foreign++;
          if (detail.length < 40) detail.push(`FOREIGN  ${name}/${id}`);
        }
      }
    }

    tMissing += missing;
    tDiffers += differs;
    tForeign += foreign;

    const flag = (missing + differs + foreign) ? "  <-- LOOK" : "";
    if (missing + differs + foreign || rows.length !== snap.size) {
      console.log(`  ${name.padEnd(24)} ${String(rows.length).padStart(6)}` +
        ` ${String(snap.size).padStart(7)}  ${String(missing).padStart(7)}` +
        ` ${String(differs).padStart(8)} ${String(foreign).padStart(8)}${flag}`);
    }
  }

  console.log(`\n  ${tChecked} production document(s) checked`);
  console.log(`  missing from the tenant : ${tMissing}`);
  console.log(`  present but changed     : ${tDiffers}`);
  console.log(`  foreign (not from prod) : ${tForeign}`);
  if (detail.length) {
    console.log("\n  first offenders:");
    detail.forEach((d) => console.log(`    ${d}`));
  }
  console.log("");
  console.log(tMissing + tDiffers + tForeign === 0 ?
    "  PRODUCTION'S OWN DATA IS INTACT and nothing foreign was imported." :
    "  DO NOT DROP THE ORIGINALS. Investigate the rows above first.");
  process.exitCode = tMissing + tDiffers + tForeign === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
