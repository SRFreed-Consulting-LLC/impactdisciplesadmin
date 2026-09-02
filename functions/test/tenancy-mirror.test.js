// The scripts/ tenancy seam is a hand-maintained DUPLICATE of the shared
// TypeScript one, because scripts/ is plain Node with no build step and
// cannot import the submodule's TypeScript.
//
// A duplicate that nothing compares is a duplicate that WILL drift, and the
// drift is invisible: a script pointed at a collection that no longer exists
// reports "0 documents, nothing to do" and exits zero. It reads exactly like
// success. This is the comparison.
//
// It runs from functions/test because that is the only node:test suite in
// the repo; it tests scripts/, not functions.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const js = require("../../scripts/lib/tenancy");

const TS_PATH = path.join(__dirname, "..", "..", "src", "common", "src",
  "shared", "lists", "tenancy.ts");

/**
 * Pulls a string-array export out of the TypeScript source by reading it,
 * rather than by compiling it - the point is to compare two files, and a
 * build step between them would be one more thing to keep in step.
 * @param {string} src File contents.
 * @param {string} name The exported const's name.
 * @return {string[]} Its members.
 */
function tsStringArray(src, name) {
  const block = src.split(`export const ${name}`)[1];
  assert.ok(block, `${name} not found in tenancy.ts`);
  // Anchor on "= [", not the first "[" - the type annotation is
  // `readonly string[]`, whose bracket comes first and yields an empty list.
  const open = block.indexOf("= [") + 2;
  const body = block.slice(open, block.indexOf("]", open) + 1);
  // COMMENT LINES OUT FIRST. The list is documented inline, and an ordinary
  // English apostrophe - "a patron's submissions" - opens a string as far as
  // a quote-matching regex is concerned, swallowing everything to the next
  // one and reporting a drift that is not there. Cost a real-looking red on
  // a check whose whole job is to be believed.
  const code = body.split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
  return [...code.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test("scripts/lib/tenancy.js has not drifted from tenancy.ts", () => {
  const ts = fs.readFileSync(TS_PATH, "utf8");

  const tsId = (ts.match(/export const TENANT_ID = '([^']+)'/) || [])[1];
  assert.strictEqual(js.TENANT_ID, tsId,
    "TENANT_ID differs between the JS and TS seams");

  assert.deepStrictEqual(
    [...js.TENANT_COLLECTIONS].sort(),
    tsStringArray(ts, "TENANT_COLLECTIONS").sort(),
    "TENANT_COLLECTIONS differs between the JS and TS seams"
  );
});

test("both seams resolve a moved collection identically", () => {
  const ts = fs.readFileSync(TS_PATH, "utf8");
  const root = (ts.match(/`([a-z]+)\/\$\{TENANT_ID\}\/\$\{table\}`/) || [])[1];
  assert.ok(root, "could not read the path root out of tenancy.ts");
  assert.strictEqual(js.tenantPath("page_content"),
    `${root}/${js.TENANT_ID}/page_content`);
});

test("neither seam ever moves an externally-owned collection", () => {
  // `mail` belongs to the firestore-send-email extension, whose watch path
  // is configured in Firebase and not in this repository; `errorLogs` is
  // written before a caller is authenticated. Moving either breaks something
  // with no code change to blame for it.
  assert.strictEqual(js.tenantPath("mail"), "mail");
  assert.strictEqual(js.tenantPath("errorLogs"), "errorLogs");
});
