// Downsamples the pictures the PAGE BUILDER's pages load, and repoints each
// piece, entry or block at the new file.
//
//   node scripts/optimise-page-images.js --project=dev
//   node scripts/optimise-page-images.js --project=dev --execute
//
// DRY RUN unless --execute. Prints every before/after so the saving is
// visible before anything is written.
//
// Why this exists: the page sweep of 2026-09-01 measured About Us loading
// 11.3MB of pictures and the kit demo 21.4MB. One file, story-3.jpg, is
// 4.78MB at 5340x3560 and took 1,845ms on a fast desktop connection - it
// appears on About Us and three times over on the demo page. Nineteen files
// across the site are over 1MB, four of them used only as the still frame
// behind a video. Nothing was broken; it was all just far larger than
// anything the site ever paints.
//
// This is the sibling of optimise-home-slider.js, which did the same job for
// `home_page_images` in August (16.5MB -> 1.6MB) and whose approach is
// copied here wholesale, including resizing through Playwright rather than
// adding an image library to this repo for one job.
//
// What it does NOT do: crop, retouch or re-frame. These are the ministry's
// own photographs and must look exactly as before, only smaller. An image
// already narrower than the cap is left completely alone rather than
// re-encoded, so re-running costs nothing and loses no quality.
//
// Reverting: the OLD Storage object is never deleted, and every record keeps
// its previous {name,url} alongside the new one as `previousImage`. Run with
// no --execute first and keep the output; it names every file it touched.

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

/**
 * Nothing on these pages is painted wider than a full-bleed band on a large
 * desktop. 2000 covers that with room for a high-density screen; the files
 * being replaced are two and a half times it.
 */
const MAX_WIDTH = 2000;
/** 85, the same as optimise-home-slider.js - a number already accepted on
 *  the ministry's own photographs rather than a fresh guess. */
const QUALITY = 85;
/** Only files big enough to be worth the round trip. */
const MIN_BYTES = 400 * 1024;
/** Files this tool has already produced; re-running must be a no-op. */
const ALREADY_DONE = /-web\.jpg$/;

/**
 * Reads pixel dimensions from a PNG or JPEG header.
 * @param {Buffer} b Image bytes.
 * @return {number[]} [width, height], or [0, 0] if unreadable.
 */
function dimensions(b) {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf &&
          marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return [0, 0];
}

/**
 * Whether a PNG COULD carry transparency - colour type 4 (grey+alpha) or 6
 * (RGBA), read from byte 25 of the header.
 *
 * This is only the cheap first question. Almost every screenshot and design
 * export is RGBA whether or not a single pixel is actually see-through, so
 * on its own it skipped nearly the whole site. `isReallyTransparent()` below
 * settles it by looking at the pixels.
 * @param {Buffer} b Image bytes.
 * @return {boolean} True when the file has an alpha channel at all.
 */
function couldHaveAlpha(b) {
  if (b.length < 26 || b[0] !== 0x89 || b[1] !== 0x50) {
    return false;
  }
  return b[25] === 4 || b[25] === 6;
}

/**
 * Whether any pixel is actually see-through.
 *
 * MATTERS BECAUSE OF HOW THIS RESIZES. The image is painted in a browser and
 * screenshotted, so anything transparent comes out flattened onto white -
 * and the output is JPEG, which has no alpha to flatten back. A logo or a
 * cut-out would gain a white box nobody asked for.
 *
 * Sampled rather than exhaustive: a stride over the alpha bytes, plus the
 * whole of the first and last row, which is where a cut-out shows first.
 * @param {import("playwright").Page} page A page already holding the image.
 * @return {Promise<boolean>} True when at least one pixel is not opaque.
 */
async function isReallyTransparent(page) {
  return page.evaluate(() => {
    const img = document.querySelector("img");
    const c = document.createElement("canvas");
    c.width = Math.min(img.naturalWidth, 1200);
    c.height = Math.min(img.naturalHeight, 1200);
    const ctx = c.getContext("2d", {willReadFrequently: true});
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const {data} = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 3; i < data.length; i += 4 * 7) {
      if (data[i] < 250) return true;
    }
    const lastRow = (c.height - 1) * c.width * 4;
    for (let x = 0; x < c.width; x++) {
      if (data[x * 4 + 3] < 250) return true;
      if (data[lastRow + x * 4 + 3] < 250) return true;
    }
    return false;
  });
}

/**
 * Every image slot on a page, as an object whose `.image` can be replaced.
 * One walk, so a picture piece, a list entry's picture and a block's own
 * background are all treated the same way.
 * @param {object} data A page_content document.
 * @return {object[]} Holders, each `{owner, where}`.
 */
function imageHolders(data) {
  const found = [];
  (data.blocks || []).forEach((block, bi) => {
    if (block.image && block.image.url) {
      found.push({owner: block, where: `#${bi} background`});
    }
    (block.columns || []).forEach((col, ci) => {
      ((col && col.pieces) || []).forEach((piece) => {
        if (piece && piece.image && piece.image.url) {
          found.push({owner: piece, where: `#${bi} col${ci} ${piece.kind}`});
        }
      });
    });
    (block.items || []).forEach((item, ii) => {
      if (item && item.image && item.image.url) {
        found.push({owner: item, where: `#${bi} item${ii}`});
      }
    });
  });
  return found;
}

/**
 * The Storage bucket for a project. Matches what the URLs in the data
 * already point at.
 * @param {string} projectId Resolved Firebase project id.
 * @return {string} Bucket name.
 */
function bucketFor(projectId) {
  return `${projectId}.appspot.com`;
}

/** @return {Promise<void>} */
async function main() {
  const execute = process.argv.includes("--execute");
  const arg = (process.argv.find((a) => a.startsWith("--project=")) || "").split("=")[1];
  const projectId = resolveProjectId(arg);
  const db = getFirestoreFor(projectId);
  // The NAMED app getFirestoreFor just created - these scripts never
  // initialise a default app, so getStorage() with no argument throws.
  const bucket = getStorage(getApp(`${projectId}::(default)`)).bucket(bucketFor(projectId));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "page-images-"));
  const browser = await chromium.launch();

  console.log(`${projectId} ${execute ? "(EXECUTING)" : "(dry run)"}\n`);

  const snap = await db.collection("page_content").get();
  // One file can be used by several pages - About Us and the demo page share
  // story-3.jpg. Convert each ONCE and repoint every user at the result.
  const converted = new Map();
  let saved = 0;
  let touched = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const holders = imageHolders(data);
    let changedThisPage = false;

    for (const {owner, where} of holders) {
      const img = owner.image;
      const name = img.name || "";
      if (ALREADY_DONE.test(name)) continue;

      if (converted.has(img.url)) {
        const done = converted.get(img.url);
        console.log(`  ${doc.id} ${where}: reuses ${done.name}`);
        if (execute) {
          owner.previousImage = {name: img.name, url: img.url};
          owner.image = {name: done.name, url: done.url};
          changedThisPage = true;
        }
        continue;
      }

      let buf;
      try {
        buf = Buffer.from(await (await fetch(img.url)).arrayBuffer());
      } catch (err) {
        console.log(`  SKIP  ${doc.id} ${where} "${name}" - could not fetch`);
        continue;
      }
      if (buf.length < MIN_BYTES) continue;

      const [width, height] = dimensions(buf);
      if (!width) {
        console.log(`  SKIP  ${doc.id} ${where} "${name}" - unreadable header ` +
          `(${buf.length} bytes) - check this one by hand`);
        continue;
      }

      const targetWidth = Math.min(MAX_WIDTH, width);
      const mime = buf[0] === 0x89 ? "image/png" : "image/jpeg";
      const outName = name.replace(/\.[^.]+$/, "")
        .replace(/[^A-Za-z0-9._-]/g, "-") + "-web.jpg";
      const outPath = path.join(tmp, outName);

      const page = await browser.newPage({viewport: {width: targetWidth, height: 600}});
      await page.setContent(
        `<style>html,body{margin:0}img{display:block;width:${targetWidth}px;height:auto}</style>` +
        `<img src="data:${mime};base64,${buf.toString("base64")}">`);
      // Only worth the pixel read when the file could be transparent at all.
      if (couldHaveAlpha(buf) && await isReallyTransparent(page)) {
        console.log(`  SKIP  ${doc.id} ${where} "${name}" - really transparent, ` +
          "would come out flattened onto white");
        await page.close();
        continue;
      }

      const box = await page.locator("img").boundingBox();
      await page.setViewportSize({width: targetWidth, height: Math.ceil(box.height)});
      await page.screenshot({path: outPath, type: "jpeg", quality: QUALITY});
      await page.close();

      const after = fs.statSync(outPath).size;
      if (after >= buf.length) {
        console.log(`  KEEP  ${doc.id} ${where} "${name}" - already smaller than a re-encode`);
        continue;
      }

      saved += buf.length - after;
      touched++;
      console.log(`  ${execute ? "RESIZE" : "would"} ${doc.id} ${where} "${name}"`);
      console.log(`         ${width}x${height} ${(buf.length / 1024).toFixed(0)}KB -> ` +
        `${targetWidth}x${Math.ceil(box.height)} ${(after / 1024).toFixed(0)}KB`);

      if (execute) {
        const object = `Web-Pages/Optimised/${outName}`;
        const token = crypto.randomUUID();
        await bucket.upload(outPath, {
          destination: object,
          metadata: {
            contentType: "image/jpeg",
            metadata: {firebaseStorageDownloadTokens: token},
          },
        });
        const next = {
          name: outName,
          url: `https://firebasestorage.googleapis.com/v0/b/${bucketFor(projectId)}` +
            `/o/${encodeURIComponent(object)}?alt=media&token=${token}`,
        };
        converted.set(img.url, next);
        owner.previousImage = {name: img.name, url: img.url};
        owner.image = next;
        changedThisPage = true;
      } else {
        converted.set(img.url, {name: outName, url: "(dry run)"});
      }
    }

    if (execute && changedThisPage) {
      // updateFields, not update: `update()` is setDoc with no merge and
      // would drop title/theme/isPublished off the document.
      await doc.ref.update({blocks: data.blocks});
      console.log(`  wrote ${doc.id}`);
    }
  }

  await browser.close();
  console.log(`\n${execute ? "Saved" : "Would save"} ` +
    `${(saved / 1024 / 1024).toFixed(1)}MB across ${touched} file(s).`);
  if (!execute) console.log("Dry run - re-run with --execute to apply.");
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
