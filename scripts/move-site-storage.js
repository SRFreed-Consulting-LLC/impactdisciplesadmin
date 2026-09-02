// Gathers a site's images under one Storage prefix -
// sites/{siteId}/... - and repoints the documents that name them.
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

const SITE_ID = "impactdisciples.com";
const PREFIX = `sites/${SITE_ID}`;
const DEV = "impactdisciplesdev";
const PROD = "impactdisciples-a82a8";

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
  return NOT_OURS.some((p) => objectPath.startsWith(p)) ||
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

  const devDb = getFirestoreFor(resolveProjectId("dev"));
  getFirestoreFor(resolveProjectId("prod"));
  const prodBucket = getStorage(getApp(`${PROD}::(default)`))
    .bucket(`${PROD}.appspot.com`);
  const devBucket = getStorage(getApp(`${DEV}::(default)`))
    .bucket(`${DEV}.appspot.com`);
  const site = devDb.collection("sites").doc(SITE_ID);

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
    const work = new Map(); // sourceKey -> {bucket, objectPath}
    const add = (bucketName, objectPath) => {
      if (businessOwned(objectPath)) return;
      work.set(`${bucketName}|${objectPath}`, {bucketName, objectPath});
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
      const target = `${PREFIX}/${objectPath}`;
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

    console.log(`${execute ? "REPOINTING" : "dry run"} dev's site documents\n`);
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
