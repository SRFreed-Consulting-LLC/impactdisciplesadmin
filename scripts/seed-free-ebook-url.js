#!/usr/bin/env node
// Puts the free-ebook download URL on the `config` singleton so it stops
// living in Cloud Functions source.
//
// Why (2026-08-28): transactional-emails.ts hardcoded a tokened Storage URL
// as FREE_EBOOK_URL, embedded in the newsletter confirmation email that ~400
// people a year still receive. The same token was ALSO shipped in the Angular
// bundle via environment.freeEbookUrl (dead key, deleted separately). Rotating
// a leaked token therefore meant editing source and redeploying functions -
// which is why it had not been done.
//
// With the URL on `config`, a future rotation is a data edit and nothing else.
//
// ORDER MATTERS: run this BEFORE deploying the functions change that reads it.
// The code omits the ebook block when the field is absent, so seeding first
// means no subscriber ever sees a confirmation missing its offer. Seeding
// after would leave a gap.
//
//   node scripts/seed-free-ebook-url.js --project=prod --url="https://..."
//   node scripts/seed-free-ebook-url.js --project=prod --url="https://..." --execute
//
// Dry run by default. Verifies the URL actually serves a PDF before writing -
// seeding a dead link is the one outcome worse than leaving the constant.

const {resolveProjectId, getFirestoreFor} = require("./lib/firestore-admin");
const {tenantCollection} = require("./lib/tenancy");

const args = {};
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith("--")) continue;
  const eq = raw.indexOf("=");
  if (eq === -1) args[raw.slice(2)] = true;
  else args[raw.slice(2, eq)] = raw.slice(eq + 1);
}

const url = args.url;
if (!url || !/^https:\/\//.test(url)) {
  console.error("  --url=\"https://...\" is required.");
  process.exit(1);
}

/** HEAD the URL and confirm it is a live PDF. */
async function verifyUrl(target) {
  const res = await fetch(target, {method: "HEAD"});
  const type = res.headers.get("content-type") ?? "";
  const size = Number(res.headers.get("content-length") ?? 0);
  return {ok: res.ok, status: res.status, type, size};
}

(async () => {
  console.log(`  verifying ${url.slice(0, 78)}...`);
  const check = await verifyUrl(url);
  if (!check.ok || !check.type.includes("pdf")) {
    console.error(
      `  REFUSING: HTTP ${check.status}, content-type "${check.type}". ` +
      "The URL must serve a live PDF before it goes on config."
    );
    process.exit(1);
  }
  console.log(`  OK - HTTP ${check.status}, ${check.size} bytes, ${check.type}`);

  const projectId = resolveProjectId(args.project);
  const db = getFirestoreFor(projectId);

  // Same rule getPaypalClientId uses: `config` is a singleton by convention
  // and nothing enforces it, so read the collection and refuse to guess
  // rather than limit(1) onto an arbitrary document.
  const snap = await tenantCollection(db, "config").get();
  if (snap.empty) {
    console.error(`  No config document on ${projectId}.`);
    process.exit(1);
  }
  if (snap.size > 1) {
    console.error(
      `  ${snap.size} config documents on ${projectId} ` +
      `(${snap.docs.map((d) => d.id).join(", ")}). Refusing to guess.`
    );
    process.exit(1);
  }

  const doc = snap.docs[0];
  const existing = doc.data().freeEbookUrl;
  console.log(`  project: ${projectId}   config doc: ${doc.id}`);
  console.log(`  current freeEbookUrl: ${existing ?? "(unset)"}`);

  if (existing === url) {
    console.log("  Already set to this URL - nothing to do.");
    return;
  }
  if (!args.execute) {
    console.log("  WOULD SET freeEbookUrl to the verified URL.");
    console.log("  Dry run. Pass --execute to write.");
    return;
  }

  await doc.ref.update({freeEbookUrl: url});
  console.log("  WROTE freeEbookUrl.");
})().catch((err) => {
  console.error("  " + err.message);
  process.exit(1);
});
