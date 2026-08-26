// Downsamples the home page slider's images (`home_page_images`) to a size a
// browser can actually use, and repoints each record at the new file.
//
//   node scripts/optimise-home-slider.js --project=prod
//   node scripts/optimise-home-slider.js --project=prod --execute
//
// DRY RUN unless --execute. Prints every before/after so the saving is
// visible before anything is written.
//
// Why this exists: on 2026-08-26 the slider was serving ~16.5MB of images on
// the home page. One was a 10951x4500 PNG of a photograph (8.5MB); another
// was a 9.6MB PNG sitting INACTIVE, one toggle away from shipping. The slides
// render at `background-size: cover` in a viewport-height hero, so nothing
// above ~2560px wide is ever visible - the rest is pure download.
//
// What it does NOT do: crop, retouch, or re-frame. These are the ministry's
// own event photographs and must look exactly as before, only smaller. An
// image already narrower than the cap is re-encoded but never upscaled.
//
// Reverting: each record keeps its previous {name,url} as `previousImage`,
// and the old Storage object is left in place - nothing is deleted.
//
// Resizing runs through Playwright (resolved from the reader app's
// node_modules, same trick the capture scripts use) rather than adding an
// image library to this repo for one job.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const {getFirestoreFor, resolveProjectId} = require("./lib/firestore-admin");

const READER = path.join(__dirname, "..", "..", "impact-discipleship-library-new");
const {chromium} = require(require.resolve("playwright", {paths: [READER]}));
const {getStorage} = require(require.resolve("firebase-admin/storage",
  {paths: [path.join(__dirname, "..", "functions")]}));
const {getApp} = require(require.resolve("firebase-admin/app",
  {paths: [path.join(__dirname, "..", "functions")]}));

/** Nothing wider than this is ever painted - see the header note. */
const MAX_WIDTH = 2560;
const QUALITY = 85;
/** Files this tool has already produced; re-running must be a no-op. */
const ALREADY_DONE = /(-web|-slide)\.jpg$/;

/**
 * Reads pixel dimensions from a PNG or JPEG header.
 * @param {Buffer} buf Image bytes.
 * @return {number[]} [width, height], or [0, 0] if unreadable.
 */
function dimensions(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  }
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xFF) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    const isSof = marker >= 0xC0 && marker <= 0xCF &&
      marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
    if (isSof) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return [0, 0];
}

/**
 * @param {string[]} argv process.argv.slice(2).
 * @return {{project: string, execute: boolean}} Parsed options.
 */
function parseArgs(argv) {
  const project = (argv.find((a) => a.startsWith("--project=")) || "").split("=")[1];
  return {project, execute: argv.includes("--execute")};
}

/**
 * @param {string} projectId Resolved Firebase project id.
 * @return {string} Its default Storage bucket.
 */
function bucketFor(projectId) {
  return projectId === "impactdisciples-a82a8" ?
    "impactdisciples-a82a8.appspot.com" :
    "impactdisciplesdev.appspot.com";
}

/** Entry point. */
async function main() {
  const {project, execute} = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(project);
  const db = getFirestoreFor(projectId);
  const bucket = getStorage(getApp(`${projectId}::(default)`)).bucket(bucketFor(projectId));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "slider-"));
  const browser = await chromium.launch();
  let saved = 0;

  console.log(`${projectId} ${execute ? "(EXECUTING)" : "(dry run)"}`);
  const snap = await db.collection("home_page_images").get();

  for (const doc of snap.docs) {
    const data = doc.data();
    const name = (data.image && data.image.name) || "";
    if (!data.image || !data.image.url || ALREADY_DONE.test(name)) continue;

    let buf;
    try {
      buf = Buffer.from(await (await fetch(data.image.url)).arrayBuffer());
    } catch (err) {
      console.log(`  SKIP   "${name}" - could not fetch`);
      continue;
    }
    const [width, height] = dimensions(buf);
    if (!width) {
      console.log(`  SKIP   "${name}" - unreadable image header ` +
        `(${buf.length} bytes) - check this record by hand`);
      continue;
    }

    const targetWidth = Math.min(MAX_WIDTH, width);
    const mime = buf[0] === 0x89 ? "image/png" : "image/jpeg";
    const outName = name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9._-]/g, "-") + "-web.jpg";
    const outPath = path.join(tmp, outName);

    const page = await browser.newPage({viewport: {width: targetWidth, height: 600}});
    await page.setContent(
      `<style>html,body{margin:0}img{display:block;width:${targetWidth}px;height:auto}</style>` +
      `<img src="data:${mime};base64,${buf.toString("base64")}">`);
    const box = await page.locator("img").boundingBox();
    await page.setViewportSize({width: targetWidth, height: Math.ceil(box.height)});
    await page.screenshot({path: outPath, type: "jpeg", quality: QUALITY});
    await page.close();

    const after = fs.statSync(outPath).size;
    saved += buf.length - after;
    console.log(`  ${execute ? "RESIZE" : "would"} "${name}"`);
    console.log(`         ${width}x${height} ${(buf.length / 1024).toFixed(0)}KB -> ` +
      `${targetWidth}x${Math.ceil(box.height)} ${(after / 1024).toFixed(0)}KB`);

    if (execute) {
      const object = `Web-Pages/Home/${outName}`;
      const token = crypto.randomUUID();
      await bucket.upload(outPath, {
        destination: object,
        metadata: {contentType: "image/jpeg", metadata: {firebaseStorageDownloadTokens: token}},
      });
      await doc.ref.update({
        image: {
          name: outName,
          url: `https://firebasestorage.googleapis.com/v0/b/${bucketFor(projectId)}` +
            `/o/${encodeURIComponent(object)}?alt=media&token=${token}`,
        },
        previousImage: data.image,
      });
    }
  }

  await browser.close();
  console.log(`${execute ? "Saved" : "Would save"} ${(saved / 1024 / 1024).toFixed(1)}MB.`);
  if (!execute) console.log("Dry run - re-run with --execute to apply.");
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
