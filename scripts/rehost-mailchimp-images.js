#!/usr/bin/env node
// Mailchimp sunset, step "images" (2026-08-20): the imported email snapshots
// (campaign_emails.html) and the imported "(Mailchimp)" templates
// (mail_templates.html + .design) still reference images on Mailchimp's CDN
// (mcusercontent.com, dim.mcusercontent.com, cdn-images.mailchimp.com).
// Those URLs die with the Mailchimp account - and the public newsletter
// archive renders those snapshots - so this re-hosts every such file in OUR
// shared Storage bucket and rewrites the docs to the new tokened URLs.
//
// - Scans every string field (recursively) of every doc in the target
//   collections for Mailchimp-hosted URLs.
// - Downloads each DISTINCT URL once, uploads it to
//   email-assets/mailchimp/<sha1(url)>.<ext> in impactdisciples-a82a8.
//   appspot.com (the one bucket all environments share - see
//   upload-social-icons.js), with a Firebase download token, exactly the URL
//   shape the rest of the site uses.
// - Remembers url -> new url in scripts/output/rehost-map.json, so the prod
//   run after the dev run (same Mailchimp URLs) re-uses the uploads instead
//   of duplicating them, and reruns converge.
// - Rewrites only the top-level fields that actually contained a URL, via
//   update(); fields whose subtree carries a Firestore Timestamp are never
//   rewritten (none are expected - html/design are plain strings/JSON - the
//   guard is defense against clobbering a date).
// - Files that no longer exist on Mailchimp (404) or aren't images are
//   reported and their URLs LEFT AS-IS - never guessed.
//
// Dry run by default (scan + count, no downloads, no writes); --execute does
// the work. Rerunnable.
//
// Usage:
//   node scripts/rehost-mailchimp-images.js --project=dev [--execute]
//     [--collections=campaign_emails,mail_templates] [--concurrency=6]
//   then the same with --project=prod (re-uses the map; uploads nothing new
//   unless prod has URLs dev didn't).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {admin, resolveProjectId, getFirestoreFor} = require("./lib/firestore-admin");

const BUCKET = "impactdisciples-a82a8.appspot.com";
const OBJECT_PREFIX = "email-assets/mailchimp";
const MAP_PATH = path.join(__dirname, "output", "rehost-map.json");

// Mailchimp-hosted FILE URLs (images). list-manage.com / mailchi.mp are
// links (forms, archive pages), not assets - deliberately not matched.
// sawa-dev-2-storage-bucket is an unrelated third-party bucket a couple of
// snapshots embedded images from (a design tool someone used) - pulled in
// too (2026-08-20, user request) so NO snapshot depends on a host we don't
// control.
const URL_RE = /https?:\/\/(?:[a-z0-9-]+\.)*(?:mcusercontent\.com|cdn-images\.mailchimp\.com|gallery\.mailchimp\.com|sawa-dev-2-storage-bucket\.storage\.googleapis\.com)\/[^\s"'<>()\\]+/gi;

const args = {};
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith("--")) continue;
  const eq = raw.indexOf("=");
  if (eq === -1) args[raw.slice(2)] = true;
  else args[raw.slice(2, eq)] = raw.slice(eq + 1);
}

/**
 * Decodes the html-attribute form of a URL (&amp; -> &) for fetching/keys.
 * @param {string} raw As found in the text.
 * @return {string} Fetchable URL.
 */
const TAIL_RE = /(&quot;?|&#39;?|&apos;?|&#34;?)+$/i;

/**
 * Splits off an html-escaped quote tail the URL regex can't see past
 * (style="background:url(&quot;https://...png&quot;)" yields "...png&quot").
 * The tail is re-appended after the rewritten URL so the markup stays intact.
 * @param {string} raw As found in the text.
 * @return {{core: string, tail: string}} URL part and trailing entity text.
 */
function splitTail(raw) {
  const m = TAIL_RE.exec(raw);
  return m ? {core: raw.slice(0, m.index), tail: m[0]} : {core: raw, tail: ""};
}

function canonical(raw) {
  return splitTail(raw).core.replace(/&amp;/g, "&").replace(/[.,;:]+$/, "");
}

/**
 * Picks a file extension from the URL path, else from the content type.
 * @param {string} url Canonical URL.
 * @param {string} contentType Response content type.
 * @return {string} Extension without the dot.
 */
function extensionFor(url, contentType) {
  const pathname = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  const m = /\.([a-z0-9]{2,5})$/i.exec(pathname);
  if (m) return m[1].toLowerCase();
  const byType = {"image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg"};
  return byType[(contentType || "").split(";")[0].trim()] || "bin";
}

/**
 * Whether a value's subtree contains a Firestore Timestamp (never rewrite those fields).
 * @param {unknown} value Field value.
 * @return {boolean} True if a Timestamp is inside.
 */
function hasTimestamp(value) {
  if (value instanceof admin.firestore.Timestamp) return true;
  if (Array.isArray(value)) return value.some(hasTimestamp);
  if (value && typeof value === "object") return Object.values(value).some(hasTimestamp);
  return false;
}

/**
 * Collects every Mailchimp URL (raw form) in a value's strings.
 * @param {unknown} value Field value.
 * @param {Set<string>} into Accumulator of raw URLs.
 */
function collectUrls(value, into) {
  if (typeof value === "string") {
    for (const m of value.matchAll(URL_RE)) into.add(m[0]);
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectUrls(v, into));
  } else if (value && typeof value === "object" && !(value instanceof admin.firestore.Timestamp)) {
    Object.values(value).forEach((v) => collectUrls(v, into));
  }
}

/**
 * Returns a copy of the value with every mapped raw URL replaced.
 * @param {unknown} value Field value.
 * @param {Map<string, string>} rawToNew raw url -> new url.
 * @return {unknown} Rewritten copy.
 */
function rewrite(value, rawToNew) {
  if (typeof value === "string") {
    return value.replace(URL_RE, (raw) => rawToNew.get(raw) ?? raw);
  }
  if (Array.isArray(value)) return value.map((v) => rewrite(v, rawToNew));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = rewrite(v, rawToNew);
    return out;
  }
  return value;
}

/**
 * Bounded-concurrency runner.
 * @param {Array<() => Promise<void>>} tasks Thunks.
 * @param {number} width Concurrency.
 * @return {Promise<void>} Done.
 */
async function pool(tasks, width) {
  let next = 0;
  const workers = Array.from({length: Math.min(width, tasks.length)}, async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      await task();
    }
  });
  await Promise.all(workers);
}

/**
 * Main.
 */
async function main() {
  const projectId = resolveProjectId(args.project);
  const execute = args.execute === true;
  const collections = String(args.collections || "campaign_emails,mail_templates").split(",").map((s) => s.trim()).filter(Boolean);
  const concurrency = Number(args.concurrency || 6);
  const db = getFirestoreFor(projectId);
  console.log(`Project: ${projectId}  mode: ${execute ? "EXECUTE" : "dry run"}  collections: ${collections.join(", ")}`);

  // url (canonical) -> {newUrl, objectPath, contentType, bytes, failed?}
  const map = fs.existsSync(MAP_PATH) ? JSON.parse(fs.readFileSync(MAP_PATH, "utf8")) : {};
  const saveMap = () => {
    fs.mkdirSync(path.dirname(MAP_PATH), {recursive: true});
    fs.writeFileSync(MAP_PATH, JSON.stringify(map, null, 2));
  };

  // ---- 1. Scan.
  const docPlans = []; // {ref, fields: {name: value}, raws: Set}
  const allRaw = new Set();
  const hostCounts = {};
  for (const name of collections) {
    const snap = await db.collection(name).get();
    let touched = 0;
    for (const doc of snap.docs) {
      const data = doc.data();
      const fields = {};
      const raws = new Set();
      for (const [field, value] of Object.entries(data)) {
        const found = new Set();
        collectUrls(value, found);
        if (found.size === 0) continue;
        if (hasTimestamp(value)) {
          console.log(`  SKIP ${name}/${doc.id}.${field}: contains a Timestamp alongside URLs (not rewritten)`);
          continue;
        }
        fields[field] = value;
        found.forEach((r) => raws.add(r));
      }
      if (raws.size > 0) {
        touched++;
        docPlans.push({ref: doc.ref, label: `${name}/${doc.id}`, fields, raws});
        raws.forEach((r) => {
          allRaw.add(r);
          try {
            const h = new URL(canonical(r)).host;
            hostCounts[h] = (hostCounts[h] || 0) + 1;
          } catch { /* ignore */ }
        });
      }
    }
    console.log(`${name}: ${snap.size} docs, ${touched} reference Mailchimp-hosted files`);
  }
  const distinct = new Map(); // canonical -> Set(raw forms)
  for (const raw of allRaw) {
    const c = canonical(raw);
    if (!distinct.has(c)) distinct.set(c, new Set());
    distinct.get(c).add(raw);
  }
  const alreadyMapped = [...distinct.keys()].filter((u) => map[u] && !map[u].failed).length;
  console.log(`Distinct files: ${distinct.size} (already re-hosted from a previous run: ${alreadyMapped}); references by host: ${JSON.stringify(hostCounts)}`);
  if (!execute) {
    console.log("\nDry run done - rerun with --execute to download/upload/rewrite.");
    return;
  }

  // ---- 2. Download + upload each distinct file once.
  const storageApp = admin.apps.find((a) => a.name === "rehost-storage") ||
    admin.initializeApp({credential: admin.credential.applicationDefault(), storageBucket: BUCKET}, "rehost-storage");
  const bucket = admin.storage(storageApp).bucket();
  let uploaded = 0;
  let reused = 0;
  let failed = 0;
  let done = 0;
  const toProcess = [...distinct.keys()].filter((u) => !(map[u] && !map[u].failed));
  console.log(`Processing ${toProcess.length} file(s) with concurrency ${concurrency}...`);
  await pool(toProcess.map((url) => async () => {
    try {
      const response = await fetch(url, {redirect: "follow"});
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const contentType = (response.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
      if (!contentType.startsWith("image/")) {
        throw new Error(`not an image (${contentType})`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0) throw new Error("empty body");
      const ext = extensionFor(url, contentType);
      const objectPath = `${OBJECT_PREFIX}/${crypto.createHash("sha1").update(url).digest("hex").slice(0, 24)}.${ext}`;
      const file = bucket.file(objectPath);
      let token;
      const [exists] = await file.exists();
      if (exists) {
        const [meta] = await file.getMetadata();
        token = meta?.metadata?.firebaseStorageDownloadTokens?.split(",")[0];
      }
      if (!token) {
        token = crypto.randomUUID();
        await file.save(bytes, {
          contentType,
          resumable: false,
          metadata: {cacheControl: "public, max-age=31536000", metadata: {firebaseStorageDownloadTokens: token, sourceUrl: url}},
        });
        uploaded++;
      } else {
        reused++;
      }
      map[url] = {
        newUrl: `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`,
        objectPath, contentType, bytes: bytes.length,
      };
    } catch (err) {
      failed++;
      map[url] = {failed: true, error: String(err.message || err)};
    } finally {
      done++;
      if (done % 50 === 0) {
        console.log(`  ${done}/${toProcess.length}...`);
        saveMap();
      }
    }
  }), concurrency);
  saveMap();
  console.log(`Files: uploaded ${uploaded}, re-used existing ${reused}, failed ${failed}.`);

  // ---- 3. Rewrite docs (only URLs that re-hosted successfully).
  const rawToNew = new Map();
  for (const [c, raws] of distinct) {
    const entry = map[c];
    if (entry && !entry.failed) raws.forEach((raw) => rawToNew.set(raw, entry.newUrl + splitTail(raw).tail));
  }
  let docsUpdated = 0;
  let fieldsUpdated = 0;
  for (const plan of docPlans) {
    const update = {};
    for (const [field, value] of Object.entries(plan.fields)) {
      const next = rewrite(value, rawToNew);
      if (JSON.stringify(next) !== JSON.stringify(value)) {
        update[field] = next;
      }
    }
    if (Object.keys(update).length > 0) {
      await plan.ref.update(update);
      docsUpdated++;
      fieldsUpdated += Object.keys(update).length;
    }
  }
  console.log(`Docs updated: ${docsUpdated} (${fieldsUpdated} fields).`);

  // ---- 4. Residual check.
  const leftovers = [...distinct.keys()].filter((u) => map[u]?.failed);
  if (leftovers.length) {
    console.log(`\nLEFT AS-IS (${leftovers.length}) - Mailchimp URL unchanged in the docs:`);
    for (const u of leftovers) console.log(`  - ${u}  (${map[u].error})`);
  } else {
    console.log("\nNo leftovers: every Mailchimp-hosted file referenced by these docs is now on our bucket.");
  }
  console.log(`Map: ${MAP_PATH}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
