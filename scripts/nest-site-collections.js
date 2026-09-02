// Copies a site's own content under one document - tenants/{tenantId}/...
//
//   node scripts/nest-site-collections.js --project=dev
//   node scripts/nest-site-collections.js --project=dev --execute
//   node scripts/nest-site-collections.js --project=dev --verify
//   node scripts/nest-site-collections.js --project=dev --drop-originals
//
// DRY RUN unless --execute. Nothing is ever deleted by --execute; the
// originals are removed by a separate --drop-originals pass, and only after
// --verify says every document arrived intact.
//
// WHY IT COPIES RATHER THAN MOVES. Data and code cannot change atomically.
// If the documents move first, every page on the site reads an empty
// collection until the deploy lands; if the code deploys first, it reads an
// empty collection until the data lands. Copying leaves BOTH paths valid, so
// the apps can be deployed in any order, verified against the live site, and
// only then does the old copy go. It also means the rollback is "deploy the
// previous build" rather than "restore from backup".
//
// The order this is meant to be run in:
//   1. deploy firestore.rules  (they already permit both paths)
//   2. this script --execute
//   3. deploy web + admin + functions
//   4. this script --verify, and check the live site
//   5. this script --drop-originals
//
// See the shared tenancy.ts for what moves and why.

const fs = require("fs");
const path = require("path");
const {getFirestoreFor, resolveProjectId} =
  require("./lib/firestore-admin");

/** Firestore's own per-commit ceiling is 500; this leaves headroom. */
const BATCH = 400;

// FROM THE SEAM, not a third copy of the list.
//
// This carried its own hand-maintained copy until 2026-09-02, on the
// reasoning that a plain node script cannot import TypeScript. True, but the
// conclusion was wrong: scripts/lib/tenancy.js is the JS mirror, and
// functions/test/tenancy-mirror.test.js compares it to the TypeScript so the
// two cannot drift.
//
// The cost of the old arrangement showed up the moment Wave 1 began. Fourteen
// collections were added to the real list, this file still named nine, and
// the migration reported "0 documents in total" - a completely successful run
// that moved nothing. Exactly the silent no-op this whole exercise exists to
// stamp out, in the tool doing the stamping.
const {TENANT_ID, TENANT_COLLECTIONS} = require("./lib/tenancy");
const SITE_HOSTNAMES = [
  "impactdisciples.com",
  "www.impactdisciples.com",
  "impactdisciplesdev-public.web.app",
];

/**
 * Reads a --key=value flag.
 * @param {string} key Flag name without dashes.
 * @return {string|undefined} Its value, if given.
 */
function arg(key) {
  const hit = process.argv.find((a) => a.startsWith(`--${key}=`));
  return hit ? hit.split("=").slice(1).join("=") : undefined;
}

/**
 * Two documents hold the same thing, ignoring key order.
 * @param {object} a One document's data.
 * @param {object} b The other's.
 * @return {boolean} True when they match.
 */
function same(a, b) {
  return JSON.stringify(a, Object.keys(a || {}).sort()) ===
    JSON.stringify(b, Object.keys(b || {}).sort());
}

/** @return {Promise<void>} */
async function main() {
  const execute = process.argv.includes("--execute");
  const verify = process.argv.includes("--verify");
  const drop = process.argv.includes("--drop-originals");
  const projectId = resolveProjectId(arg("project"));
  const db = getFirestoreFor(projectId);
  const site = db.collection("tenants").doc(TENANT_ID);

  const mode = drop ? "DROPPING ORIGINALS" :
    verify ? "VERIFYING" : execute ? "COPYING" : "dry run";
  console.log(`${projectId} (${mode})`);
  console.log(`  target: tenants/${TENANT_ID}\n`);

  // ---- verify: every source document present and identical at the target
  if (verify) {
    let missing = 0;
    let differs = 0;
    let checked = 0;
    for (const name of TENANT_COLLECTIONS) {
      const from = await db.collection(name).get();
      const to = await site.collection(name).get();
      const toById = new Map(to.docs.map((d) => [d.id, d.data()]));
      let bad = 0;
      from.forEach((d) => {
        checked++;
        if (!toById.has(d.id)) {
          missing++;
          bad++;
        } else if (!same(d.data(), toById.get(d.id))) {
          differs++;
          bad++;
        }
      });
      console.log(`  ${name.padEnd(18)} ${String(from.size).padStart(3)} source ` +
        `-> ${String(to.size).padStart(3)} nested  ${bad ? `${bad} PROBLEM(S)` : "ok"}`);
    }
    console.log(`\n  ${checked} document(s) checked, ${missing} missing, ` +
      `${differs} different.`);
    console.log(missing + differs === 0 ?
      "  Safe to --drop-originals." :
      "  NOT safe to drop. Re-run --execute, or look at the differences.");
    return;
  }

  // ---- drop: remove the top-level originals, once verified
  if (drop) {
    let removed = 0;
    for (const name of TENANT_COLLECTIONS) {
      const from = await db.collection(name).get();
      const to = await site.collection(name).get();
      if (from.size && to.size < from.size) {
        console.log(`  REFUSING ${name}: ${from.size} at the top level but ` +
          `only ${to.size} nested. Run --verify.`);
        process.exitCode = 1;
        return;
      }
      for (let i = 0; i < from.docs.length; i += BATCH) {
        const batch = db.batch();
        from.docs.slice(i, i + BATCH).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      removed += from.size;
      console.log(`  dropped ${name} (${from.size})`);
    }
    console.log(`\n  ${removed} original document(s) removed.`);
    return;
  }

  // ---- copy
  const plan = [];
  let total = 0;
  for (const name of TENANT_COLLECTIONS) {
    const snap = await db.collection(name).get();
    plan.push({name, docs: snap.docs});
    total += snap.size;
    console.log(`  ${name.padEnd(18)} ${String(snap.size).padStart(3)} document(s)`);
  }
  console.log(`\n  ${total} document(s) in total`);

  if (!execute) {
    console.log("\nDry run. Re-run with --execute to write.");
    return;
  }

  // A backup of the SOURCE, so --drop-originals is recoverable from disk as
  // well as from the nested copy.
  const out = path.join(__dirname, "backups",
    `site-collections-${projectId}-before-nesting.json`);
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, JSON.stringify(
    Object.fromEntries(plan.map((p) => [
      p.name, p.docs.map((d) => ({id: d.id, data: d.data()})),
    ])), null, 1));
  console.log(`\n  backed up to ${path.relative(process.cwd(), out)}`);

  // The site document itself. merge:true so a re-run cannot wipe fields
  // somebody has since edited in the admin.
  await site.set({
    name: "Impact Disciples",
    hostnames: SITE_HOSTNAMES,
    isActive: true,
  }, {merge: true});
  console.log(`  wrote tenants/${TENANT_ID}`);

  for (const {name, docs} of plan) {
    for (let i = 0; i < docs.length; i += BATCH) {
      const batch = db.batch();
      docs.slice(i, i + BATCH).forEach((d) => {
        batch.set(site.collection(name).doc(d.id), d.data());
      });
      await batch.commit();
    }
    console.log(`  copied ${name} (${docs.length})`);
  }

  console.log("\n  Originals are UNTOUCHED. Deploy, check the site, then " +
    "run --verify and --drop-originals.");
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
