#!/usr/bin/env node
// One-time setup for the email builder's social block: downloads a small
// brand icon PNG per network (Google's s2 favicon service - returns each
// site's real favicon as a PNG) and uploads them to the shared Storage
// bucket under email-assets/social/, printing the tokened download URLs to
// paste into DEFAULT_SOCIAL_ICON_URLS (src/app/common/models/admin/
// email-design.model.ts). All environments share the one bucket
// (impactdisciples-a82a8.appspot.com - see src/environments/*), so this
// runs once, ever, unless an icon needs refreshing.
//
// Usage: node scripts/upload-social-icons.js
// Auth: Application Default Credentials (same as export.js - see
// scripts/lib/firestore-admin.js's comment).

const path = require("path");
const crypto = require("crypto");

const functionsDir = path.join(__dirname, "..", "functions");
const admin = require(
  require.resolve("firebase-admin", {paths: [functionsDir]})
);

const BUCKET = "impactdisciples-a82a8.appspot.com";

const NETWORKS = {
  facebook: "facebook.com",
  instagram: "instagram.com",
  x: "x.com",
  youtube: "youtube.com",
  linkedin: "linkedin.com",
  tiktok: "tiktok.com",
};

/**
 * Fetches one favicon PNG.
 * @param {string} domain Site domain.
 * @return {Promise<Buffer>} PNG bytes.
 */
async function fetchIcon(domain) {
  const url =
    `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`favicon fetch failed for ${domain}: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

(async () => {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    storageBucket: BUCKET,
  });
  const bucket = admin.storage().bucket();

  for (const [network, domain] of Object.entries(NETWORKS)) {
    const bytes = await fetchIcon(domain);
    const token = crypto.randomUUID();
    const objectPath = `email-assets/social/${network}.png`;
    await bucket.file(objectPath).save(bytes, {
      contentType: "image/png",
      metadata: {metadata: {firebaseStorageDownloadTokens: token}},
    });
    const url =
      `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/` +
      `${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
    console.log(`${network}: '${url}',`);
  }
  console.log("Done - paste the URLs into DEFAULT_SOCIAL_ICON_URLS.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
