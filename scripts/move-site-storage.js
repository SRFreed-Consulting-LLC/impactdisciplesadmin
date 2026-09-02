// Gathers a site's images under one Storage prefix -
// tenants/{tenantId}/... - and repoints the documents that name them.
//
//   node scripts/move-site-storage.js --copy
//   node scripts/move-site-storage.js --copy --execute
//   node scripts/move-site-storage.js --repoint --execute
//   node scripts/move-site-storage.js --verify
//
// DRY RUN unless --execute. NOTHING IS EVER DELETED by this script. The
// originals stay exactly where they are, because production is still serving
// the pre-migration site from them - deleting an object the live site
// references breaks it the moment the copy runs, with no deploy involved.
// They go by hand, after the prod cutover.
//
// EVERYTHING LANDS IN THE PROD BUCKET, both environments. That is a
// deliberate choice (owner, 2026-09-02): one copy of every image, and no
// rewrite needed at cutover. The cost is real and worth stating - editing or
// replacing an image from the DEV admin changes it on the LIVE SITE, because
// they are the same object. Dev is not a safe place to experiment with
// pictures any more.
//
// WHAT MOVES, and why it is not simply a list of folders. The referenced
// images are not where you would guess:
//
//   Web-Pages/            107 references
//   Coaching-With-Impact/   9
//   Logos/                  1
//   (bucket root)          13   <- every team headshot, loose in the root
//   Store/ + EBooks/        3   <- NOT MOVED, see below
//
// So it walks what the nine site collections actually NAME, plus the folders
// that are wholly the site's, rather than trusting a folder list. Headshots/
// and Icons/ turn out to be referenced by nothing at all.
//
// Store/ and EBooks/ are left where they are on purpose. A site page showing
// a product photo is a cross-reference to a business asset, not site
// content; copying those under the site would make a second copy of
// something the store owns and would drift the moment the store updates it.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {getFirestoreFor, resolveProjectId, getApp} =
  require("./lib/firestore-admin");
const {getStorage} = require(require.resolve("firebase-admin/storage",
  {paths: [path.join(__dirname, "..", "functions")]}));

const TENANT_ID = "impactdisciples.com";
const PREFIX = `tenants/${TENANT_ID}`;
const DEV = "impactdisciplesdev";
const PROD = "impactdisciples-a82a8";

/**
 * Prefixes this script has used BEFORE, which must be stripped rather than
 * nested under.
 *
 * The root was `sites/{id}` until the rename on 2026-09-02, and the
 * documents were repointed at it before that happened - so the object paths
 * this script now reads out of Firestore already carry the old prefix.
 * Prepending the new one to them yields
 * `tenants/x/sites/x/Web-Pages/...`, an object that exists, resolves, and is
 * wrong: every later run would bury it one level deeper again.
 *
 * Kept as a LIST rather than removed once used, because the same thing is
 * true of any future rename and the cost of carrying it is one array.
 */
const OLD_PREFIXES = [`sites/${TENANT_ID}/`];

/**
 * The object's path with any previous tenant prefix removed, so a re-run
 * re-parents rather than re-nests.
 * @param {string} objectPath A path read from a stored download URL.
 * @return {string} The path as it was before any prefixing.
 */
function unprefixed(objectPath) {
  const hit = OLD_PREFIXES.find((p) => objectPath.startsWith(p));
  return hit ? objectPath.slice(hit.length) : objectPath;
}

/** Folders that belong wholly to the site, copied entire. */
const SITE_FOLDERS = ["Web-Pages/", "Coaching-With-Impact/", "Headshots/", "Icons/"];

/** Referenced prefixes that belong to the BUSINESS and stay put. */
const NOT_OURS = ["Store/", "EBooks/", "email-assets/", "Blogs/",
  "firestore-backup-", "book-imports/"];

/** The nine collections a site owns. */
const COLS = ["page_content", "site_navigation", "site_footer", "dock_bar",
  "config", "testimonials", "impact_team", "dmms", "faq"];

const MANIFEST = path.join(__dirname, "backups",
  "site-storage-manifest.json");

/**
 * Every Storage download URL inside a value, however deeply nested.
 * @param {*} v Any document value.
 * @param {string[]} out Collected URLs.
 * @return {string[]} out
 */
function urlsIn(v, out) {
  if (!v) return out;
  if (typeof v === "string") {
    if (v.includes("firebasestorage.googleapis.com")) out.push(v);
    return out;
  }
  if (Array.isArray(v)) {
    v.forEach((x) => urlsIn(x, out));
    return out;
  }
  if (typeof v === "object") {
    Object.values(v).forEach((x) => urlsIn(x, out));
    return out;
  }
  return out;
}

/**
 * Splits a download URL into the bucket and object path it names.
 * @param {string} url A firebasestorage download URL.
 * @return {{bucket: string, objectPath: string}|null} Its parts.
 */
function parseUrl(url) {
  const b = (url.match(/\/v0\/b\/([^/]+)\//) || [])[1];
  const o = (url.match(/\/o\/([^?]+)/) || [])[1];
  if (!b || !o) return null;
  return {bucket: b, objectPath: decodeURIComponent(o)};
}

/**
 * A public download URL for an object, with a fresh token.
 * @param {string} bucket Bucket name.
 * @param {string} objectPath Full object path.
 * @param {string} token Its firebaseStorageDownloadTokens value.
 * @return {string} The URL.
 */
function downloadUrl(bucket, objectPath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}` +
    `/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

/** @return {boolean} Whether this object belongs to the business, not us. */
function businessOwned(objectPath) {
  // Tested against the UNPREFIXED path: an object already parked under an
  // old tenant root still belongs to whoever it belonged to before, and
  // `Store/x.png` and `sites/id/Store/x.png` must reach the same verdict.
  const bare = unprefixed(objectPath);
  return NOT_OURS.some((p) => bare.startsWith(p)) ||
    objectPath.startsWith(`${PREFIX}/`);
}

/** @return {Promise<void>} */
async function main() {
  const execute = process.argv.includes("--execute");
  const doCopy = process.argv.includes("--copy");
  const doRepoint = process.argv.includes("--repoint");
  const doVerify = process.argv.includes("--verify");

  if (!doCopy && !doRepoint && !doVerify) {
    console.error("Pick a phase: --copy, --repoint or --verify.");
    process.exit(1);
  }

  // WHICH ENVIRONMENT'S DOCUMENTS. The objects always live in the PROD
  // bucket - that was the deliberate choice, one copy of every image and no
  // rewrite at cutover - but the DOCUMENTS that name them exist separately
  // in each environment and each set has to be repointed on its own.
  //
  // This defaulted to dev and had no way to say otherwise, which was fine
  // until production's own forty image URLs needed moving and the only
  // honest answer was "the script cannot do that yet".
  const env = (process.argv.find((a) => a.startsWith("--project=")) || "")
    .split("=")[1] || "dev";
  if (!["dev", "prod"].includes(env)) {
    console.error(`Unknown --project=${env}. Use dev or prod.`);
    process.exit(1);
  }
  const db = getFirestoreFor(resolveProjectId(env));
  // BOTH apps, whichever environment's documents we are rewriting. The
  // Storage handles below need an initialised app per bucket, and a source
  // URL can still name the dev bucket whoever is running this - so
  // initialising only the chosen project throws on the first such URL.
  getFirestoreFor(resolveProjectId("prod"));
  getFirestoreFor(resolveProjectId("dev"));
  const prodBucket = getStorage(getApp(`${PROD}::(default)`))
    .bucket(`${PROD}.appspot.com`);
  const devBucket = getStorage(getApp(`${DEV}::(default)`))
    .bucket(`${DEV}.appspot.com`);
  const site = db.collection("tenants").doc(TENANT_ID);

  // ---- what the site actually names
  const referenced = new Set();
  for (const c of COLS) {
    const snap = await site.collection(c).get();
    snap.forEach((d) => urlsIn(d.data(), []).forEach((u) => referenced.add(u)));
  }

  // ---- verify: every referenced URL resolves
  if (doVerify) {
    let ok = 0;
    const bad = [];
    for (const url of referenced) {
      const res = await fetch(url, {method: "GET",
        headers: {Range: "bytes=0-0"}}).catch(() => null);
      if (res && res.ok) ok++;
      else bad.push(url);
    }
    console.log(`${referenced.size} distinct image URL(s) referenced`);
    console.log(`  reachable: ${ok}`);
    console.log(`  BROKEN:    ${bad.length}`);
    bad.slice(0, 10).forEach((u) => console.log(`    ${u.slice(0, 110)}`));
    const nested = [...referenced].filter((u) => u.includes(
      encodeURIComponent(`${PREFIX}/`))).length;
    console.log(`  already under ${PREFIX}: ${nested}`);
    return;
  }

  // ---- copy
  if (doCopy) {
    // KEYED BY DESTINATION, not by source. The same picture is reached two
    // ways - once because a document names it, once because the folder scan
    // walks it - and after a re-parent those two arrive under different
    // names (`Web-Pages/x.png` and `sites/id/Web-Pages/x.png`) that resolve
    // to one target. Keying by source counted it twice and reported 218
    // objects where there were 172.
    const work = new Map(); // targetPath -> {bucketName, objectPath}
    const add = (bucketName, objectPath) => {
      if (businessOwned(objectPath)) return;
      const target = `${PREFIX}/${unprefixed(objectPath)}`;
      // First writer wins, and the reference scan runs first - so the path a
      // document actually names is preferred over the one the folder walk
      // guessed at.
      if (!work.has(target)) work.set(target, {bucketName, objectPath});
    };

    // Everything the site names...
    for (const url of referenced) {
      const p = parseUrl(url);
      if (p) add(p.bucket, p.objectPath);
    }
    // ...plus the folders that are wholly the site's, in prod.
    for (const folder of SITE_FOLDERS) {
      const [files] = await prodBucket.getFiles({prefix: folder});
      files.forEach((f) => add(`${PROD}.appspot.com`, f.name));
    }

    console.log(`${execute ? "COPYING" : "dry run"} into ` +
      `${PROD}.appspot.com/${PREFIX}/\n`);
    const bySource = {};
    for (const {bucketName, objectPath} of work.values()) {
      bySource[bucketName] = (bySource[bucketName] || 0) + 1;
    }
    Object.entries(bySource).forEach(([k, v]) =>
      console.log(`  ${String(v).padStart(4)} object(s) from ${k}`));
    console.log(`  ${work.size} in total\n`);

    if (!execute) {
      console.log("Dry run. Re-run with --execute to copy.");
      return;
    }

    const manifest = {};
    let copied = 0;
    let skipped = 0;
    for (const {bucketName, objectPath} of work.values()) {
      const from = bucketName.startsWith(DEV) ? devBucket : prodBucket;
      // Re-PARENT, never re-nest: strip any earlier tenant root first, or a
      // second run buries the object one level deeper and still "works".
      const target = `${PREFIX}/${unprefixed(objectPath)}`;
      const dest = prodBucket.file(target);

      const [exists] = await dest.exists();
      let token;
      if (exists) {
        const [meta] = await dest.getMetadata();
        token = (meta.metadata || {}).firebaseStorageDownloadTokens;
        skipped++;
      }
      if (!token) {
        token = crypto.randomUUID();
        if (!exists) {
          await from.file(objectPath).copy(dest);
          copied++;
        }
        await dest.setMetadata({metadata:
          {firebaseStorageDownloadTokens: token}});
      }
      manifest[`${bucketName}|${objectPath}`] =
        downloadUrl(`${PROD}.appspot.com`, target, token);
    }

    fs.mkdirSync(path.dirname(MANIFEST), {recursive: true});
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
    console.log(`  copied ${copied}, already present ${skipped}`);
    console.log(`  manifest -> ${path.relative(process.cwd(), MANIFEST)}`);
    console.log("\n  Originals UNTOUCHED. Next: --repoint --execute");
    return;
  }

  // ---- repoint
  if (doRepoint) {
    if (!fs.existsSync(MANIFEST)) {
      console.error("No manifest. Run --copy --execute first.");
      process.exit(1);
    }
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));

    /** Rewrites every URL in a value, returning [newValue, changedCount]. */
    const rewrite = (v) => {
      if (typeof v === "string") {
        const p = parseUrl(v);
        if (!p) return [v, 0];
        const hit = manifest[`${p.bucket}|${p.objectPath}`];
        return hit && hit !== v ? [hit, 1] : [v, 0];
      }
      if (Array.isArray(v)) {
        let n = 0;
        const out = v.map((x) => {
          const [nv, c] = rewrite(x);
          n += c;
          return nv;
        });
        return [out, n];
      }
      if (v && typeof v === "object") {
        let n = 0;
        const out = {};
        for (const [k, val] of Object.entries(v)) {
          const [nv, c] = rewrite(val);
          out[k] = nv;
          n += c;
        }
        return [out, n];
      }
      return [v, 0];
    };

    console.log(`${execute ? "REPOINTING" : "dry run"} ${env}'s site documents\n`);
    let total = 0;
    for (const c of COLS) {
      const snap = await site.collection(c).get();
      let touched = 0;
      let changes = 0;
      for (const d of snap.docs) {
        const [next, n] = rewrite(d.data());
        if (!n) continue;
        touched++;
        changes += n;
        if (execute) await d.ref.set(next);
      }
      if (touched) {
        console.log(`  ${c.padEnd(18)} ${touched} doc(s), ${changes} URL(s)`);
      }
      total += changes;
    }
    console.log(`\n  ${total} URL(s) ${execute ? "rewritten" : "would change"}`);
    if (!execute) console.log("Dry run. Re-run with --execute.");
    else console.log("  Next: --verify, then check the live site.");
  }
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
