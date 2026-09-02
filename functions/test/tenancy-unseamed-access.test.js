// NOTHING MAY NAME A TENANT COLLECTION BY STRING LITERAL.
//
// The bug this exists to prevent, found live on 2026-09-02: the reader app
// has no FirebaseDAO, so it builds Firestore paths directly -
// `collection(this.firestore, 'config')`. `config` had already moved under
// the tenant, so the reader's checkout could no longer find a PayPal client
// id. Nothing failed at build time, no test covered it, and the migration
// plan had listed the reader as unaffected because it does not read the
// SITE's collections. It read one of them anyway, through a path nobody had
// thought to look at.
//
// The lesson is that the seam is only worth what covers it. A grep is a poor
// substitute for a type, but the alternative here is three Angular apps, a
// functions project and a scripts directory agreeing by memory - and memory
// is exactly what failed.
//
// SCOPE, deliberately narrow: only the collections that have ACTUALLY moved
// (TENANT_COLLECTIONS). A name that has not moved is still legitimately a
// literal, and flagging those would make this noisy enough to be switched
// off - which is how a check stops working.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const {TENANT_COLLECTIONS} = require("../../scripts/lib/tenancy");

const REPO = path.join(__dirname, "..", "..");
const WORKSPACE = path.join(REPO, "..");

/** Every app and project that talks to this Firestore database. */
const ROOTS = [
  path.join(REPO, "src", "app"),
  path.join(REPO, "functions", "src"),
  path.join(REPO, "scripts"),
  path.join(WORKSPACE, "impactdisciples - web", "src", "app"),
  path.join(WORKSPACE, "impact-discipleship-library-new", "src", "app"),
  path.join(REPO, "src", "common", "src", "queries"),
];

/** Files that are allowed to say the names out loud. */
const ALLOWED = [
  // The seams themselves, and their tests, must name them.
  path.join("shared", "lists", "tenancy"),
  path.join("scripts", "lib", "tenancy"),
  // Migration tooling works on both sides of a move by definition.
  path.join("scripts", "nest-site-collections"),
  path.join("scripts", "rename-tenant-root"),
  path.join("scripts", "move-site-storage"),
  // A DIFFERENT COLLECTION THAT HAPPENS TO SHARE A NAME. This one reads
  // `series` out of the LEGACY library project's database and writes it here
  // as `librarySeries`; the store's own `series` is an unrelated collection
  // that merely spells the same. Seaming it would point a one-off import at
  // a path that has never existed in the source project.
  path.join("scripts", "migrate-library-content-to-nested"),
];

/** @return {string[]} Every source file under a root. */
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "common") continue;
      walk(full, out);
    } else if (/\.(ts|js)$/.test(entry.name) && !/\.spec\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

test("no app names a moved collection by string literal", () => {
  const offenders = [];

  for (const root of ROOTS) {
    for (const file of walk(root)) {
      if (ALLOWED.some((a) => file.includes(a))) continue;
      // Remove the CORRECT usages before looking for incorrect ones.
      // `collection(db, tenantPath("config"))` otherwise matches a pattern
      // hunting for `collection(db, "config")` - the seam call sits inside
      // the very parentheses being searched, so every properly-seamed call
      // site reports itself. A check with two dozen false positives is a
      // check somebody deletes.
      const src = fs.readFileSync(file, "utf8")
        .replace(/tenantPath\(\s*['"`][^'"`]+['"`]\s*\)/g, "SEAMED")
        .replace(/tenantCollection\([^,]+,\s*['"`][^'"`]+['"`]\s*\)/g, "SEAMED")
        .replace(/triggerPath\(\s*['"`][^'"`]+['"`][^)]*\)/g, "SEAMED");

      for (const name of TENANT_COLLECTIONS) {
        // The shapes that actually reach Firestore. A collection named in a
        // COMMENT or in unrelated prose is not a path, and flagging it would
        // make this check noise.
        const q = `['"\`]${name}['"\`]`;
        const patterns = [
          // collection(firestore, 'config') / doc(db, "config")
          new RegExp(`(collection|doc|collectionGroup)\\([^)]*${q}`),
          // db.collection("config")
          new RegExp(`\\.(collection|doc)\\(\\s*${q}`),
          // this.table = 'config'  (the BaseService declaration)
          new RegExp(`\\btable\\s*[:=]\\s*${q}`),
        ];
        if (patterns.some((p) => p.test(src))) {
          offenders.push(`${path.relative(WORKSPACE, file)} -> ${name}`);
        }
      }
    }
  }

  assert.deepStrictEqual(offenders, [],
    "These name a collection that has MOVED under the tenant, without going " +
    "through tenantPath(). They will read an empty collection and say " +
    "nothing:\n  " + offenders.join("\n  "));
});
