// Repairs Firestore documents that name a Storage object by a DEAD download
// token.
//
//   node scripts/repair-storage-tokens.js --project=prod
//   node scripts/repair-storage-tokens.js --project=prod --execute
//   node scripts/repair-storage-tokens.js --project=dev --only=products
//
// DRY RUN unless --execute. Nothing is ever deleted, and a URL is only
// rewritten when the object is still in the bucket - a genuinely missing
// file is reported, never papered over.
//
// WHY THIS EXISTS. A Firebase download URL carries a token that lives in the
// OBJECT's metadata, not in the URL. Re-uploading a file mints a NEW token,
// and every document still holding the old URL starts returning 403. The
// document looks fine in the console, the image is still in the bucket, and
// the only symptom is a broken picture on a page nobody happened to open.
//
// Found on 2026-09-02 by fetching every referenced image rather than reading
// documents: "How to Have a Healthy Marriage" - a live $20 product - had had
// a broken cover on the storefront and in the reader's store for an unknown
// length of time. One product doc, one field, both environments.
//
// THE CHECK IS THE FETCH. Reading a document can only ever tell you it holds
// a URL; the only thing that can prove the picture appears is asking for the
// bytes. This walks every collection, fetches one byte of every image, and
// repairs what comes back 403/404 - so it can, and did, go red.

const path = require("path");
const {getFirestoreFor, resolveProjectId, getApp} =
  require("./lib/firestore-admin");
const {getStorage} = require(require.resolve("firebase-admin/storage",
  {paths: [path.join(__dirname, "..", "functions")]}));

/**
 * Every Storage download URL inside a value, with the field path that holds
 * it, however deeply nested.
 * @param {*} v Any document value.
 * @param {string} at Dotted path to `v` within the document.
 * @param {Array<{path: string, url: string}>} out Collected hits.
 * @return {Array<{path: string, url: string}>} out
 */
function urlsIn(v, at, out) {
  if (!v) return out;
  if (typeof v === "string") {
    // The string must BE a URL, not merely contain one. Email bodies in
    // `mail` and `mail_templates` are whole HTML documents with images
    // embedded in them; treating one as a URL fetches nothing, "repairs" the
    // first token in the markup and rewrites the entire message body.
    if (/^https:\/\/firebasestorage\.googleapis\.com\/[^\s"'<>]*$/.test(v)) {
      out.push({path: at, url: v});
    }
    return out;
  }
  if (Array.isArray(v)) {
    v.forEach((x, i) => urlsIn(x, `${at}.${i}`, out));
    return out;
  }
  if (typeof v === "object") {
    Object.entries(v).forEach(([k, x]) => urlsIn(x, at ? `${at}.${k}` : k, out));
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

/** @return {Promise<void>} */
async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const projectArg = (args.find((a) => a.startsWith("--project=")) || "")
    .split("=")[1] || "dev";
  const onlyArg = (args.find((a) => a.startsWith("--only=")) || "")
    .split("=")[1];

  const projectId = resolveProjectId(projectArg);
  const db = getFirestoreFor(projectId);
  const buckets = new Map();

  /** @return {object} A lazily-opened bucket handle. */
  const bucketFor = (name) => {
    if (!buckets.has(name)) {
      buckets.set(name, getStorage(getApp(`${projectId}::(default)`))
        .bucket(name));
    }
    return buckets.get(name);
  };

  const names = onlyArg ?
    onlyArg.split(",").map((s) => s.trim()) :
    (await db.listCollections()).map((c) => c.id);

  console.log(`${execute ? "REPAIRING" : "dry run"} ${projectId}\n`);

  // One fetch per DISTINCT url - the same picture is named by many documents.
  const checked = new Map();
  /** @return {Promise<boolean>} Whether the bytes actually come back. */
  const reachable = async (url) => {
    if (!checked.has(url)) {
      const res = await fetch(url, {method: "GET",
        headers: {Range: "bytes=0-0"}}).catch(() => null);
      checked.set(url, !!(res && res.ok));
    }
    return checked.get(url);
  };

  const liveToken = new Map();
  /** @return {Promise<string|null>} The object's CURRENT token, if it exists. */
  const tokenFor = async (bucket, objectPath) => {
    const key = `${bucket}|${objectPath}`;
    if (!liveToken.has(key)) {
      const file = bucketFor(bucket).file(objectPath);
      const [exists] = await file.exists();
      if (!exists) {
        liveToken.set(key, null);
      } else {
        const [meta] = await file.getMetadata();
        liveToken.set(key,
          (meta.metadata || {}).firebaseStorageDownloadTokens || null);
      }
    }
    return liveToken.get(key);
  };

  let scanned = 0;
  let repaired = 0;
  const missing = [];
  const unfixable = [];

  for (const name of names) {
    const snap = await db.collection(name).get();
    for (const doc of snap.docs) {
      const hits = urlsIn(doc.data(), "", []);
      const updates = {};
      for (const hit of hits) {
        scanned++;
        if (await reachable(hit.url)) continue;

        const parts = parseUrl(hit.url);
        if (!parts) {
          unfixable.push(`${name}/${doc.id} ${hit.path} (unparseable URL)`);
          continue;
        }
        const token = await tokenFor(parts.bucket, parts.objectPath);
        if (!token) {
          missing.push(`${name}/${doc.id} ${hit.path} -> ${parts.objectPath}`);
          continue;
        }
        const fixed = hit.url.replace(/token=[^&]*/, `token=${token}`);
        if (!(await reachable(fixed))) {
          unfixable.push(`${name}/${doc.id} ${hit.path} (new token also 403)`);
          continue;
        }
        updates[hit.path] = fixed;
        repaired++;
        console.log(`  ${name}/${doc.id}`);
        console.log(`    ${hit.path}  ${parts.objectPath}`);
      }
      // Dotted keys are a MERGE of those fields only - never a whole-doc
      // overwrite, which would drop anything this script did not read.
      if (execute && Object.keys(updates).length) await doc.ref.update(updates);
    }
  }

  console.log(`\n  ${scanned} image reference(s) checked`);
  console.log(`  ${repaired} ${execute ? "repaired" : "repairable"}`);
  if (missing.length) {
    console.log(`\n  ${missing.length} OBJECT GONE FROM THE BUCKET ` +
      "(needs a re-upload, not a token):");
    missing.forEach((m) => console.log(`    ${m}`));
  }
  if (unfixable.length) {
    console.log(`\n  ${unfixable.length} could not be repaired:`);
    unfixable.forEach((m) => console.log(`    ${m}`));
  }
  if (!execute && repaired) console.log("\nDry run. Re-run with --execute.");
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
