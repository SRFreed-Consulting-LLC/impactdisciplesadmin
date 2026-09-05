// THE THREE APPS MUST POINT AT THE SAME SHARED-SUBMODULE COMMIT.
//
// src/common is one git submodule checked out in three repos, and each repo
// carries its own pointer. Nothing enforced that they agree, and on
// 2026-09-05 they did not: admin at the tip, web two commits behind, the
// reader ten - with the tenancy list, the functions contract and the
// project config among the files in the reader's gap. A pointer that lags
// is invisible: every app builds, every suite is green, and the apps simply
// disagree about a shared name.
//
// This runs inside `npm run check-functions`, which gates every admin
// hosting and functions deploy on the machine where all three checkouts
// sit side by side (see tenancy-unseamed-access.test.js for the same
// convention). Where a sibling is absent - GitHub Actions checks out one
// repo - it reports that and passes, because there is nothing to compare.
//
// The pointer is read with `git ls-tree HEAD src/common`, which needs no
// submodule init and reports what the repo's HEAD COMMIT records, not what
// happens to be checked out in the working tree.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const {execFileSync} = require("node:child_process");

const REPO = path.join(__dirname, "..", "..");
const WORKSPACE = path.join(REPO, "..");

const REPOS = [
  {name: "admin", dir: REPO},
  {name: "web", dir: path.join(WORKSPACE, "impactdisciples - web")},
  {
    name: "reader",
    dir: path.join(WORKSPACE, "impact-discipleship-library-new"),
  },
];

/**
 * The submodule commit a repo's HEAD records, or null when the repo is not
 * present on this machine.
 * @param {string} dir Repo root.
 * @return {string|null} 40-char sha, or null.
 */
function pointerOf(dir) {
  if (!fs.existsSync(path.join(dir, ".gitmodules"))) return null;
  const out = execFileSync("git", ["-C", dir, "ls-tree", "HEAD", "src/common"],
    {encoding: "utf8"});
  const m = out.match(/\b([0-9a-f]{40})\b/);
  return m ? m[1] : null;
}

test("every checked-out app records the same src/common commit", () => {
  const found = REPOS
    .map((r) => ({...r, sha: pointerOf(r.dir)}))
    .filter((r) => r.sha !== null);
  assert.ok(found.some((r) => r.name === "admin"),
    "this repo's own pointer could not be read");
  if (found.length < REPOS.length) {
    const missing = REPOS.filter((r) => !found.some((f) => f.name === r.name))
      .map((r) => r.name);
    console.log("submodule-parity: sibling checkout(s) absent here " +
      `(${missing.join(", ")}) - nothing to compare against.`);
    return;
  }
  const shas = new Set(found.map((r) => r.sha));
  assert.strictEqual(shas.size, 1,
    "src/common pointers differ:\n" +
    found.map((r) => `  ${r.sha.slice(0, 7)}  ${r.name}`).join("\n") +
    "\nBump the lagging repo(s) to the tip (git -C src/common checkout " +
    "<sha>, build, test, commit the pointer).");
});
