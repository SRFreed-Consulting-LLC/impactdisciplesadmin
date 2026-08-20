// Backfills the public newsletter archive flag from the legacy
// `monthly-newsletter` collection (2026-08-20).
//
// The web app's Monthly Newsletter page used to read `monthly-newsletter`
// rows ({date, title, url, isActive}) whose urls were Mailchimp archive
// links. Those sends now live in `campaign_emails` as `mc_<mailchimpId>`
// touches (import-mailchimp-campaigns.js), and the page reads touches
// flagged `publishToWeb` through the newsletter_archive function instead.
// This script maps each legacy row's url to its touch via the Mailchimp
// API's archive_url/long_archive_url (the import didn't capture those) and
// sets {publishToWeb: true, webTitle: <row title>} on the touch. The curated
// list spans several campaigns (Monthly Newsletter, Prayer Letter, and
// standalone sends) - which is exactly why the flag is per touch.
//
// Dry run by default; --execute writes. Rerunnable (idempotent sets).
// Unmatched rows are reported, never guessed.
//
// Usage (PowerShell):
//   $env:MAILCHIMP_API_KEY = (firebase functions:secrets:access MAILCHIMP_API_KEY --project impactdisciplesdev); node scripts/backfill-newsletter-archive.js --project=dev [--execute]
//   (prod: --project=prod with the prod key)

const {resolveProjectId, getFirestoreFor} = require("./lib/firestore-admin");

const args = {};
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith("--")) continue;
  const eq = raw.indexOf("=");
  if (eq === -1) args[raw.slice(2)] = true;
  else args[raw.slice(2, eq)] = raw.slice(eq + 1);
}

const API_KEY = (process.env.MAILCHIMP_API_KEY || "").trim();
if (!API_KEY || !API_KEY.includes("-")) {
  console.error("Set MAILCHIMP_API_KEY (format xxxx-usNN) in the environment.");
  process.exit(1);
}
const DC = API_KEY.split("-").pop();
const BASE = `https://${DC}.api.mailchimp.com/3.0`;
const AUTH = "Basic " + Buffer.from("anystring:" + API_KEY).toString("base64");

/**
 * Mailchimp API GET helper.
 * @param {string} pathname API path.
 * @return {Promise<object>} Parsed response.
 */
async function mc(pathname) {
  const response = await fetch(BASE + pathname, {headers: {"Authorization": AUTH}});
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`GET ${pathname} -> ${response.status}: ${data?.detail ?? data?.title ?? "unknown"}`);
  }
  return data;
}

/**
 * Normalizes an archive url for matching (scheme/host case, trailing slash).
 * @param {string} url Raw url.
 * @return {string} Normalized key.
 */
function urlKey(url) {
  return String(url || "").trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * Main.
 */
async function main() {
  const projectId = resolveProjectId(args.project);
  const execute = args.execute === true;
  const db = getFirestoreFor(projectId);
  console.log(`Project: ${projectId}  mode: ${execute ? "EXECUTE" : "dry run"}`);

  const legacySnap = await db.collection("monthly-newsletter").get();
  console.log(`Legacy monthly-newsletter rows: ${legacySnap.size}`);
  if (legacySnap.empty) {
    console.log("Nothing to backfill.");
    return;
  }

  const mcList = await mc(
    "/campaigns?status=sent&count=1000&fields=campaigns.id," +
    "campaigns.archive_url,campaigns.long_archive_url");
  const byArchive = new Map();
  for (const campaign of mcList.campaigns ?? []) {
    for (const u of [campaign.archive_url, campaign.long_archive_url]) {
      if (u) byArchive.set(urlKey(u), campaign.id);
    }
  }
  console.log(`Mailchimp sent campaigns: ${(mcList.campaigns ?? []).length}`);

  let matched = 0;
  let written = 0;
  const unmatched = [];
  for (const doc of legacySnap.docs) {
    const row = doc.data();
    const title = String(row.title ?? "").trim();
    const mcId = byArchive.get(urlKey(row.url));
    if (!mcId) {
      unmatched.push({id: doc.id, title, url: row.url ?? null, reason: "url not a Mailchimp archive url"});
      continue;
    }
    const touchRef = db.collection("campaign_emails").doc(`mc_${mcId}`);
    const touch = await touchRef.get();
    if (!touch.exists) {
      unmatched.push({id: doc.id, title, url: row.url, reason: `touch mc_${mcId} not imported`});
      continue;
    }
    matched++;
    const current = touch.data();
    const already = current.publishToWeb === true && (current.webTitle ?? null) === (title || null);
    console.log(`${already ? "  =" : "  +"} ${title.padEnd(60).slice(0, 60)} -> mc_${mcId} (${current.campaignId})`);
    if (execute && !already) {
      await touchRef.update({publishToWeb: true, webTitle: title || null});
      written++;
    }
  }

  console.log(`\nMatched ${matched}/${legacySnap.size}; ${execute ? `updated ${written}` : "no writes (dry run)"}.`);
  if (unmatched.length) {
    console.log("UNMATCHED (left alone - handle by hand in Campaigns Manager):");
    for (const u of unmatched) console.log("  -", u);
  }
  if (!execute) console.log("\nRe-run with --execute to write.");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
