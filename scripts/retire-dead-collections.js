// Deletes collections that nothing reads any more.
//
//   node scripts/retire-dead-collections.js --project=prod
//   node scripts/retire-dead-collections.js --project=prod --execute
//
// DRY RUN unless --execute.
//
// WHY THESE FOUR, and why only after the cutover:
//
//   courses (35)            The Courses concept was retired 2026-08-19 -
//                           breakout agenda items carry their own text,
//                           description and coaches now.
//   home_page_images (10)   The home slider's slides. Superseded by the
//   coaching_page (1)       section kit: the home page and Coaching with
//                           Impact are ordinary page_content documents.
//   email_lists (4)         The saved-lists feature, removed app-wide. It
//                           has no firestore.rules entry at all - default
//                           deny - so nothing could read it even if
//                           something tried.
//
// The first three were LIVE IN PRODUCTION until the tenancy cutover, because
// production was still serving the pre-section-kit web build and that build
// was the only thing reading them. They could not be touched until the new
// bundle shipped and was verified - which is exactly why this is a separate
// script run afterwards rather than a step inside the migration.
//
// TWO REFUSALS, both for things that have actually gone wrong here before:
//
//   - A document with SUBCOLLECTIONS. Deleting the parent strands the
//     children where no listCollections() from the root will ever reach
//     them: they do not appear in the console and nothing enumerates them.
//     Production had five such orphans in `discussionGroups`, left by an
//     earlier cascade that only walked some subcollections.
//   - A collection still named by live application code. The check is
//     deliberately crude and errs towards refusing.

const fs = require("fs");
const path = require("path");
const {getFirestoreFor, resolveProjectId} = require("./lib/firestore-admin");
const {TENANT_COLLECTIONS} = require("./lib/tenancy");

const DEAD = ["courses", "home_page_images", "coaching_page", "email_lists"];

/** Application source roots - not scripts, not tests, not comments. */
const ROOTS = [
  path.join(__dirname, "..", "src", "app"),
  path.join(__dirname, "..", "functions", "src"),
  path.join(__dirname, "..", "..", "impactdisciples - web", "src", "app"),
  path.join(__dirname, "..", "..", "impact-discipleship-library-new",
    "src", "app"),
];

/** @return {string[]} Every non-spec source file under a root. */
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|js)$/.test(e.name) && !/\.spec\./.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

/** @return {string[]} Files that name `collection` in real code. */
function liveReferences(collection) {
  const hits = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const src = fs.readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join("\n");
      const q = `['"\`]${collection}['"\`]`;
      if (new RegExp(`(collection|doc)\\([^)]*${q}`).test(src) ||
        new RegExp(`\\.(collection|doc)\\(\\s*${q}`).test(src) ||
        new RegExp(`\\btable\\s*[:=]\\s*${q}`).test(src)) {
        hits.push(path.relative(path.join(__dirname, ".."), file));
      }
    }
  }
  return hits;
}

/** @return {Promise<void>} */
async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const env = (args.find((a) => a.startsWith("--project=")) || "")
    .split("=")[1];
  if (!env) {
    console.error("Missing --project=<dev|prod>. There is no default.");
    process.exit(1);
  }

  const projectId = resolveProjectId(env);
  const db = getFirestoreFor(projectId);
  console.log(`${execute ? "DELETING FROM" : "dry run"} ${projectId}\n`);

  let total = 0;
  const plan = [];
  for (const name of DEAD) {
    if (TENANT_COLLECTIONS.includes(name)) {
      console.error(`REFUSING ${name}: it is in TENANT_COLLECTIONS, so it ` +
        "is migrated data rather than dead data.");
      process.exit(1);
    }
    const refs = liveReferences(name);
    if (refs.length) {
      console.error(`REFUSING ${name}: still named by live code -`);
      refs.forEach((r) => console.error(`    ${r}`));
      process.exit(1);
    }
    // listDocuments(), so a fieldless parent holding children is seen.
    const docRefs = await db.collection(name).listDocuments();
    for (const r of docRefs) {
      const subs = await r.listCollections();
      if (subs.length) {
        console.error(`REFUSING ${name}: ${r.id} has subcollection(s) ` +
          `${subs.map((s) => s.id).join(", ")} - deleting the parent would ` +
          "strand them where nothing can enumerate them again.");
        process.exit(1);
      }
    }
    plan.push({name, refs: docRefs});
    total += docRefs.length;
    console.log(`  ${name.padEnd(20)} ${String(docRefs.length).padStart(4)}` +
      " document(s), no live reader, no subcollections");
  }

  console.log(`\n  ${total} document(s) in total`);
  if (!execute) {
    console.log("\nDry run. Re-run with --execute to delete.");
    console.log("Take a backup first: npm run backup:prod");
    return;
  }

  for (const {name, refs} of plan) {
    let batch = db.batch();
    let n = 0;
    for (const r of refs) {
      batch.delete(r);
      if (++n % 400 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }
    if (n % 400) await batch.commit();
    console.log(`  deleted ${name} (${refs.length})`);
  }
  console.log(`\n  ${total} document(s) removed.`);
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
