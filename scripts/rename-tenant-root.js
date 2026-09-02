// Renames the ROOT a tenant's data hangs from - `sites/{id}` -> `tenants/{id}`
// - by copying the whole tree, verifying it, and only then dropping the old
// one.
//
//   node scripts/rename-tenant-root.js --project=dev
//   node scripts/rename-tenant-root.js --project=dev --execute
//   node scripts/rename-tenant-root.js --project=dev --verify
//   node scripts/rename-tenant-root.js --project=dev --drop-source
//
// DRY RUN unless --execute. --drop-source refuses unless --verify would pass.
//
// WHY A COLLECTION GETS RENAMED AT ALL. The root was called `sites` when the
// only thing under it was a website: nine collections the public site renders
// and Page Manager edits. The goal now is everything the ministry owns -
// customers, purchases, events, the library - under one parent, and at that
// point "sites" is simply the wrong noun for the thing it contains.
//
// A DOCUMENT ID CAN NEVER BE RENAMED and a collection can only be renamed by
// copying it, so this gets cheaper the earlier it happens: 81 documents
// today, 15,749 after the rest of the migration. That timing is the entire
// argument for doing it now rather than living with the name.
//
// The tenant id itself - `impactdisciples.com` - does NOT change. It reads as
// a domain and is deliberately not used as one (see SITE_HOSTNAMES in the
// shared tenancy module); it is a stable key, and stable keys are the one
// thing worth not touching.
//
// COPY, NEVER MOVE. While both roots exist and hold identical data, the apps,
// the functions and the rules can each be deployed in any order without a
// window where something reads a path that is not there. That is what makes
// this reversible right up until --drop-source.

const {getFirestoreFor, resolveProjectId} = require("./lib/firestore-admin");
const {toPortable} = require("./lib/firestore-json");
const {deepEqual} = require("./lib/deep-equal");

const DEFAULT_FROM = "sites";
const DEFAULT_TO = "tenants";
const DEFAULT_ID = "impactdisciples.com";

/**
 * Compares two documents ignoring the Storage prefix and download tokens.
 *
 * WHY THIS EXISTS, and why it is not a --force flag. The destination is
 * legitimately allowed to move AHEAD of the source between the copy and the
 * drop: `move-site-storage.js` re-parents the images and rewrites the URLs
 * that name them, and it only ever rewrites the LIVE copy. So a perfectly
 * healthy migration ends with 29 documents differing, and the drop guard -
 * correctly - refuses.
 *
 * A `--force` would answer that by switching the guard off, which also
 * switches it off for the case it exists to catch: a document that diverged
 * because something was still writing to the old root. This normalises away
 * exactly the one difference that is expected and compares everything else
 * strictly, so a real divergence still stops the drop.
 *
 * @param {object} a A document's data.
 * @param {object} b The other document's data.
 * @return {boolean} Whether they match once the prefix and tokens are gone.
 */
function equalIgnoringStoragePrefix(a, b) {
  const strip = (v) => JSON.stringify(toPortable(v))
    .replace(/(sites|tenants)%2F[^%]+%2F/g, "")
    .replace(/token=[0-9a-f-]{36}/g, "token=X");
  return strip(a) === strip(b);
}

/**
 * Parses simple --key=value / --flag CLI arguments.
 * @param {string[]} argv process.argv.slice(2).
 * @return {Object<string,string|boolean>} Parsed args.
 */
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

/**
 * Walks a document and everything beneath it, depth-first, parents first.
 *
 * Firestore has no "copy this subtree" call and a document's children are
 * only discoverable by asking it, one metadata call at a time - so the shape
 * of the tree has to be learned rather than assumed. Parents are emitted
 * before their children so a copy run never writes into a document that does
 * not exist yet.
 *
 * @param {FirebaseFirestore.DocumentReference} docRef Root document.
 * @param {string} label Path as printed.
 * @return {Promise<Array<{label: string, ref: object, snap: object}>>} Nodes.
 */
async function walk(docRef, label) {
  const out = [];
  const snap = await docRef.get();
  out.push({label, ref: docRef, snap});
  const subs = await docRef.listCollections();
  for (const sub of subs) {
    const docs = await sub.get();
    for (const d of docs.docs) {
      const nested = await walk(d.ref, `${label}/${sub.id}/${d.id}`);
      out.push(...nested);
    }
  }
  return out;
}

/** @return {Promise<void>} */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project) {
    console.error("Missing --project=<dev|prod|projectId>. " +
      "There is no default - specify one explicitly.");
    process.exit(1);
  }
  const execute = !!args.execute;
  const doVerify = !!args.verify;
  const doDrop = !!args["drop-source"];
  const from = String(args.from || DEFAULT_FROM);
  const to = String(args.to || DEFAULT_TO);
  const id = String(args.id || DEFAULT_ID);

  const projectId = resolveProjectId(String(args.project));
  const db = getFirestoreFor(projectId);
  const srcRoot = db.collection(from).doc(id);
  const dstRoot = db.collection(to).doc(id);

  /** Maps a source node's path onto its destination reference. */
  const dstFor = (label) => {
    const rest = label.slice(`${from}/${id}`.length);
    return rest ? db.doc(`${to}/${id}${rest}`) : dstRoot;
  };

  // ---- verify: every source node must exist at the destination, equal.
  if (doVerify) {
    const nodes = await walk(srcRoot, `${from}/${id}`);
    let checked = 0;
    let missing = 0;
    let different = 0;
    for (const n of nodes) {
      if (!n.snap.exists) continue;
      checked++;
      const other = await dstFor(n.label).get();
      if (!other.exists) {
        missing++;
        console.log(`  MISSING  ${n.label}`);
        continue;
      }
      if (!deepEqual(toPortable(n.snap.data()), toPortable(other.data()))) {
        different++;
        console.log(`  DIFFERS  ${n.label}`);
      }
    }
    console.log(`\n  ${checked} document(s) checked, ${missing} missing, ` +
      `${different} different.`);
    // A verify that cannot go red is worse than no verify at all. Say so
    // plainly rather than printing a green nobody can interpret.
    if (checked === 0) {
      console.log("  NOTHING TO CHECK - the source is already gone. This " +
        "run proves nothing.");
      process.exit(1);
    }
    console.log(missing + different === 0 ?
      "  Safe to --drop-source." :
      "  NOT SAFE. Re-run --execute, or investigate.");
    process.exit(missing + different === 0 ? 0 : 1);
  }

  // ---- drop: refuses on anything the verify pass would have flagged.
  if (doDrop) {
    const lenient = !!args["ignore-storage-prefix"];
    const nodes = await walk(srcRoot, `${from}/${id}`);
    const live = nodes.filter((n) => n.snap.exists);
    let forgiven = 0;
    for (const n of live) {
      const other = await dstFor(n.label).get();
      if (!other.exists) {
        console.error(`REFUSING: ${n.label} is missing at ${to}/.`);
        process.exit(1);
      }
      const src = toPortable(n.snap.data());
      const dst = toPortable(other.data());
      if (deepEqual(src, dst)) continue;
      // Differs. Only one difference is ever expected here.
      if (lenient && equalIgnoringStoragePrefix(src, dst)) {
        forgiven++;
        continue;
      }
      console.error(`REFUSING: ${n.label} differs at ${to}/ by more than ` +
        "the storage prefix. Run --verify, and find out what wrote it.");
      process.exit(1);
    }
    if (forgiven) {
      console.log(`  ${forgiven} document(s) differ ONLY by the storage ` +
        "prefix - the destination is ahead, as expected after a re-parent.");
    }
    if (!execute) {
      console.log(`Dry run: would delete ${live.length} document(s) under ` +
        `${from}/${id}. Re-run with --execute.`);
      return;
    }
    // Children before parents - the reverse of the copy order. A deleted
    // parent leaves its children as orphans that no listCollections() call
    // from the root will ever find again.
    for (const n of [...live].reverse()) await n.ref.delete();
    console.log(`Deleted ${live.length} document(s) under ${from}/${id}.`);
    return;
  }

  // ---- copy
  const nodes = await walk(srcRoot, `${from}/${id}`);
  const live = nodes.filter((n) => n.snap.exists);
  console.log(`${execute ? "COPYING" : "dry run"}  ${projectId}`);
  console.log(`  ${from}/${id}  ->  ${to}/${id}\n`);

  const byCollection = {};
  for (const n of live) {
    const parts = n.label.split("/");
    const col = parts.length > 2 ? parts[parts.length - 2] : "(the root doc)";
    byCollection[col] = (byCollection[col] || 0) + 1;
  }
  Object.entries(byCollection)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`));
  console.log(`  ${String(live.length).padStart(4)}  in total\n`);

  if (!execute) {
    console.log("Dry run. Re-run with --execute to copy. NOTHING IS DELETED " +
      "by a copy - the old root stays until --drop-source.");
    return;
  }

  let written = 0;
  for (const n of live) {
    await dstFor(n.label).set(n.snap.data());
    written++;
  }
  console.log(`  wrote ${written} document(s)`);
  console.log(`\n  Source UNTOUCHED. Next: --verify, then deploy the code, ` +
    `then --drop-source --execute.`);
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
