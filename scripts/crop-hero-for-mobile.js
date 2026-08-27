#!/usr/bin/env node
// Cuts a PHONE/TABLET version of a PAGE HERO image (the <app-header> banner)
// and uploads it beside the original.
//
// Unlike the home slider, page hero URLs are hard-coded in the web app's
// templates rather than held in Firestore - so this only uploads the file and
// prints the URL. Paste that into the page's [mobileBackgroundUrl].
//
// Same reasoning as crop-slide-for-mobile.js: several heroes are wide banner
// GRAPHICS with the subject pushed to one side (the store header is book
// covers in the right half of a 1622x696 canvas). Fitting one whole into a
// phone makes it too small to read; filling the frame crops the subject out.
// A hero that matters on a phone gets a picture cut for a phone.
//
//   node scripts/crop-hero-for-mobile.js --project=prod \
//     --url="https://firebasestorage.../store-header.PNG?alt=media&token=..." \
//     --crop=560,0,1062,696 --name=store-header-mobile.jpg [--execute]
"use strict";

const path = require("path");
const { chromium } = require(require.resolve("playwright", { paths: [path.join(__dirname, "..")] }));
const { resolveProjectId, initializeApp, applicationDefault } = require("./lib/firestore-admin");

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectId = resolveProjectId(args.project);
  const execute = args.execute === true;
  if (!args.url) throw new Error("Pass --url=<source image url>");
  if (!args.crop) throw new Error("Pass --crop=x,y,w,h in SOURCE pixels");
  if (!args.name) throw new Error("Pass --name=<output filename>");

  const [cx, cy, cw, ch] = String(args.crop).split(",").map(Number);
  if ([cx, cy, cw, ch].some((n) => !Number.isFinite(n))) throw new Error("--crop must be four numbers");

  const objectPath = `Web-Pages/Headers/${args.name}`;
  console.log(`${projectId}  (${execute ? "LIVE" : "dry run"})`);
  console.log(`  crop       : x=${cx} y=${cy} ${cw}x${ch}  ratio ${(cw / ch).toFixed(2)}`);
  console.log(`  will write : ${objectPath}`);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("about:blank");
  const bytes = Buffer.from(await (await page.request.get(args.url)).body());
  const dataUrl = await page.evaluate(async ({ src, c }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    if (c.x + c.w > img.naturalWidth || c.y + c.h > img.naturalHeight) {
      throw new Error(`crop falls outside the ${img.naturalWidth}x${img.naturalHeight} source`);
    }
    const cv = document.createElement("canvas");
    cv.width = c.w;
    cv.height = c.h;
    cv.getContext("2d").drawImage(img, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
    return cv.toDataURL("image/jpeg", 0.86);
  }, { src: "data:image/jpeg;base64," + bytes.toString("base64"), c: { x: cx, y: cy, w: cw, h: ch } });
  await browser.close();

  const buffer = Buffer.from(dataUrl.split(",")[1], "base64");
  console.log(`  cropped    : ${Math.round(buffer.length / 1024)} KB`);
  if (!execute) return console.log("  dry run - nothing uploaded. Re-run with --execute.");

  const { getStorage } = require(
    require.resolve("firebase-admin/storage", { paths: [path.join(__dirname, "..", "functions")] })
  );
  const app = initializeApp(
    { credential: applicationDefault(), projectId, storageBucket: `${projectId}.appspot.com` },
    `hero-${projectId}-${Date.now()}`
  );
  const bucket = getStorage(app).bucket();
  const token = require("crypto").randomUUID();
  await bucket.file(objectPath).save(buffer, {
    contentType: "image/jpeg",
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  });
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}` +
    `/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
  console.log(`  URL        : ${url}`);
}

main().catch((e) => {
  console.error("  " + e.message);
  process.exit(1);
});
