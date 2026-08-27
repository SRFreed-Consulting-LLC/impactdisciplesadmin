#!/usr/bin/env node
// Cuts a PHONE/TABLET version of a home slider image and attaches it to the
// slide as `mobileImage`.
//
// WHY THIS EXISTS
// The slide images are wide desktop banners - 2560x1200 for the event slides.
// Neither way of fitting one onto a 390px phone works: `contain` shows all of
// it at a 6.6x reduction, which leaves the wordmark inside too small to read,
// and `cover` keeps it legible by cropping half the picture away. So a slide
// that matters on a phone gets artwork cut for a phone, and the web app picks
// it below 992px (see HomeHeaderSliderComponent.slideImageUrl).
//
// Near-square (5:4) is the target: it fills a phone frame with almost no
// letterboxing.
//
// The original is never touched - this uploads a NEW object beside it and only
// writes the `mobileImage` field. Clearing that field in Content Manager puts
// the slide back to using the wide image at every size.
//
//   node scripts/crop-slide-for-mobile.js --project=dev --match=golf \
//        --crop=1060,0,1500,1200
//   ... add --execute to actually upload and write.
"use strict";

const path = require("path");
const { chromium } = require(require.resolve("playwright", { paths: [path.join(__dirname, "..")] }));
const { resolveProjectId, getFirestoreFor, initializeApp, applicationDefault } = require("./lib/firestore-admin");

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
  const match = String(args.match || "").toLowerCase();
  const execute = args.execute === true;
  if (!match) throw new Error("Pass --match=<filename fragment>");
  if (!args.crop) throw new Error("Pass --crop=x,y,w,h in SOURCE pixels");

  const [cx, cy, cw, ch] = String(args.crop).split(",").map(Number);
  if ([cx, cy, cw, ch].some((n) => !Number.isFinite(n))) throw new Error("--crop must be four numbers");

  const db = getFirestoreFor(projectId);
  const snap = await db.collection("home_page_images").get();
  const hits = [];
  snap.forEach((d) => {
    const url = decodeURIComponent(d.data().image?.url || "");
    if (url.toLowerCase().includes(match)) hits.push({ ref: d.ref, data: d.data(), url });
  });
  if (hits.length !== 1) throw new Error(`${hits.length} slides match "${match}" - need exactly one`);

  const hit = hits[0];
  const sourcePath = hit.url.split("/o/")[1].split("?")[0];
  const sourceName = sourcePath.split("/").pop();
  const sourceDir = sourcePath.slice(0, sourcePath.length - sourceName.length);
  const outName = sourceName.replace(/\.(jpe?g|png|webp)$/i, "") + "-mobile.jpg";
  const objectPath = `${sourceDir}${outName}`;

  console.log(`${projectId}  (${execute ? "LIVE" : "dry run"})`);
  console.log(`  slide       : ${sourceName}`);
  console.log(`  crop        : x=${cx} y=${cy} ${cw}x${ch}  ratio ${(cw / ch).toFixed(2)}`);
  console.log(`  will write  : ${objectPath}`);
  console.log(`  existing    : mobileImage = ${hit.data.mobileImage ? hit.data.mobileImage.name : "(none)"}`);

  // Crop in a browser canvas - no native image dependency to install.
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("about:blank");
  const sourceBytes = Buffer.from(await (await page.request.get(hit.data.image.url)).body());
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
  }, { src: "data:image/jpeg;base64," + sourceBytes.toString("base64"), c: { x: cx, y: cy, w: cw, h: ch } });
  await browser.close();

  const buffer = Buffer.from(dataUrl.split(",")[1], "base64");
  console.log(`  cropped     : ${Math.round(buffer.length / 1024)} KB`);

  if (!execute) {
    console.log("  dry run - nothing uploaded or written. Re-run with --execute.");
    return;
  }

  const { getStorage } = require(
    require.resolve("firebase-admin/storage", { paths: [path.join(__dirname, "..", "functions")] })
  );
  const app = initializeApp(
    { credential: applicationDefault(), projectId, storageBucket: `${projectId}.appspot.com` },
    `crop-${projectId}-${Date.now()}`
  );
  const bucket = getStorage(app).bucket();
  const token = require("crypto").randomUUID();
  const file = bucket.file(objectPath);
  await file.save(buffer, {
    contentType: "image/jpeg",
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  });
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}` +
    `/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;

  await hit.ref.update({ mobileImage: { name: outName, url } });
  console.log(`  uploaded    : ${url.slice(0, 96)}...`);
  console.log(`  mobileImage : set on the slide`);
}

main().catch((e) => {
  console.error("  " + e.message);
  process.exit(1);
});
