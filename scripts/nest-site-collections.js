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

/**
 * The OTHER per-commit ceiling, and the one that actually bit. Firestore
 * rejects a commit over ~11.5MB of payload regardless of how few writes it
 * holds. Deliberately a third of that: JSON.stringify measures the shape of
 * the data, not the encoded wire size, so the margin absorbs the difference
 * rather than pretending the estimate is exact.
 */
const MAX_BATCH_BYTES = 4 * 1024 * 1024;

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

  /**
   * Every document under a collection, INCLUDING descendants, paired with
   * where each belongs at the target. Parents before children.
   *
   * THIS SCRIPT WAS FLAT UNTIL WAVE 3, and that was survivable only by
   * accident: the first 35 collections it moved happened to have no
   * subcollections at all. `libraryUsers` has four - a patron's lesson
   * submissions, their highlights, their progress markers, their push token -
   * `discussionGroups` has four more, and `librarySeries` is a whole
   * books/units/lessons/translations tree. A flat copy takes the parent
   * documents, leaves 208+ children behind, and prints "copied". Then
   * --verify agrees, because it compared flat too. Then --drop-originals
   * deletes the only remaining copy.
   *
   * Firestore has no "copy this subtree" call and a document's children are
   * only discoverable by asking it, one metadata round-trip per document -
   * so this is slow on a large collection and that is the price of not
   * silently discarding a patron's study history.
   *
   * @param {object} srcCol Source collection reference.
   * @param {object} dstCol Its twin under the tenant.
   * @return {Promise<Array<{src: object, dst: object, snap: object}>>} Nodes.
   */
  async function walkTree(srcCol, dstCol) {
    const snap = await srcCol.get();
    const out = [];
    // PROBED IN PARALLEL, and that is not a micro-optimisation. There is one
    // round-trip per document and no way around it, so `customers` alone is
    // 5,450 of them; done one at a time the dry run did not finish inside ten
    // minutes, which is the kind of slow that gets a safety check skipped.
    const LANES = 40;
    for (let i = 0; i < snap.docs.length; i += LANES) {
      const slice = snap.docs.slice(i, i + LANES);
      const subLists = await Promise.all(
        slice.map((d) => d.ref.listCollections()));
      for (let j = 0; j < slice.length; j++) {
        const d = slice[j];
        const dst = dstCol.doc(d.id);
        out.push({src: d.ref, dst, snap: d});
        // Recursion stays sequential: it is only reached by the handful of
        // documents that actually HAVE children, so the parallelism that
        // matters is the probe above, not this.
        for (const sub of subLists[j]) {
          out.push(...await walkTree(sub, dst.collection(sub.id)));
        }
      }
    }
    return out;
  }

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
      const nodes = await walkTree(
        db.collection(name), site.collection(name));
      let bad = 0;
      let subs = 0;
      // getAll() in chunks, not one read per document. Sequentially this was
      // 13,422 round-trips and did not finish inside ten minutes - and a
      // safety check nobody has the patience to run is a safety check that
      // does not exist.
      const CHUNK = 300;
      for (let i = 0; i < nodes.length; i += CHUNK) {
        const slice = nodes.slice(i, i + CHUNK);
        const snaps = await db.getAll(...slice.map((n) => n.dst));
        slice.forEach((n, j) => {
          checked++;
          if (n.src.parent.id !== name) subs++;
          const other = snaps[j];
          if (!other.exists) {
            missing++;
            bad++;
          } else if (!same(n.snap.data(), other.data())) {
            differs++;
            bad++;
          }
        });
      }
      const depth = subs ? ` (+${subs} in subcollections)` : "";
      console.log(`  ${name.padEnd(18)} ${String(nodes.length).padStart(4)} ` +
        `document(s)${depth}  ${bad ? `${bad} PROBLEM(S)` : "ok"}`);
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
      const nodes = await walkTree(
        db.collection(name), site.collection(name));
      // Every node, not just the parents - a count check that ignored
      // children would happily green-light deleting the only copy of them.
      for (const n of nodes) {
        const other = await n.dst.get();
        if (!other.exists || !same(n.snap.data(), other.data())) {
          console.log(`  REFUSING ${name}: ${n.src.path} is missing or ` +
            "differs under the tenant. Run --verify.");
          process.exitCode = 1;
          return;
        }
      }
      // CHILDREN BEFORE PARENTS, the reverse of the copy order. Deleting a
      // parent first leaves its subcollections as orphans that no
      // listCollections() from the top will ever reach again - they do not
      // show in the console and nothing enumerates them.
      const ordered = [...nodes].reverse();
      for (let i = 0; i < ordered.length; i += BATCH) {
        const batch = db.batch();
        ordered.slice(i, i + BATCH).forEach((n) => batch.delete(n.src));
        await batch.commit();
      }
      removed += nodes.length;
      console.log(`  dropped ${name} (${nodes.length})`);
    }
    console.log(`\n  ${removed} original document(s) removed.`);
    return;
  }

  // ---- copy
  const plan = [];
  let total = 0;
  for (const name of TENANT_COLLECTIONS) {
    const nodes = await walkTree(db.collection(name), site.collection(name));
    if (!nodes.length) continue;
    plan.push({name, nodes});
    total += nodes.length;
    const subs = nodes.filter((n) => n.src.parent.id !== name).length;
    console.log(`  ${name.padEnd(18)} ${String(nodes.length).padStart(4)} ` +
      `document(s)${subs ? ` (+${subs} in subcollections)` : ""}`);
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
  // BY FULL PATH, not by id. Once subcollections are in scope an id alone no
  // longer says where a document belongs - `submissions/lesson-3` exists
  // under every patron who ever opened lesson 3. A backup that cannot be
  // restored to the right place is not a backup, and this file is the only
  // thing standing behind --drop-originals other than the nested copy it is
  // meant to be independent of.
  fs.writeFileSync(out, JSON.stringify(
    Object.fromEntries(plan.map((p) => [
      p.name, p.nodes.map((n) => ({
        path: n.src.path,
        id: n.src.id,
        data: n.snap.data(),
      })),
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

  // BATCHED BY BYTES AS WELL AS BY COUNT. Firestore caps a commit at 500
  // writes AND at ~11.5MB of payload, and only the first of those is
  // obvious. `campaign_emails` holds whole rendered HTML email bodies, so
  // 400 of them is tens of megabytes - the copy died mid-collection with
  // "Request payload size exceeds the limit" and left 1,096 documents
  // behind. The count cap alone is a limit that works until the day the
  // documents get big.
  for (const {name, nodes} of plan) {
    let batch = db.batch();
    let ops = 0;
    let bytes = 0;
    // Walk order is parents-first, so a child is never written before the
    // document it hangs from exists.
    for (const n of nodes) {
      // JSON length is an approximation of the wire size, not the wire size
      // - which is exactly why the ceiling below is a third of the real one.
      const size = JSON.stringify(n.snap.data() ?? {}).length;
      if (ops > 0 && (ops >= BATCH || bytes + size > MAX_BATCH_BYTES)) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
        bytes = 0;
      }
      batch.set(n.dst, n.snap.data());
      ops++;
      bytes += size;
    }
    if (ops > 0) await batch.commit();
    console.log(`  copied ${name} (${nodes.length})`);
  }

  console.log("\n  Originals are UNTOUCHED. Deploy, check the site, then " +
    "run --verify and --drop-originals.");
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
