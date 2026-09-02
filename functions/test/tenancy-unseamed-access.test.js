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
  // THE TESTS THEMSELVES, added after they proved they needed it. The
  // trigger-liveness suite queried `customers` by literal while asserting
  // that a trigger had written it - so the day `customers` moved, the suite
  // would have looked in the old place and failed, or worse, found a stale
  // document there and passed. A test that hardcodes a path it is supposed
  // to be checking is the least useful kind of green.
  path.join(REPO, "integration"),
  path.join(REPO, "e2e-admin"),
  path.join(REPO, "e2e-cross"),
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

  // CROSS-DATABASE ONE-OFFS, allow-listed rather than seamed - and the
  // distinction is the point, not an excuse.
  //
  // Each of these reads one database and writes another: a named legacy
  // database, a restored backup, or dev-to-prod. Only ONE SIDE of each has
  // moved under the tenant, so a mechanical rewrite makes the other side
  // wrong - pointing a source read at a path that never existed there, or a
  // prod write at a path prod has not got yet. Half-seaming them correctly
  // is possible and was deliberately not done: they are finished migrations
  // kept as the record of what was run, re-running them is not a supported
  // operation, and an edit nobody can verify is worse than a name in a list.
  //
  // If one is ever genuinely needed again, seam the side that has moved and
  // remove it from here - do not run it as it stands.
  path.join("scripts", "migrate-library-reader-owned-collections"),
  path.join("scripts", "migrate-library-users-submissions"),
  path.join("scripts", "migrate-highlights-from-backup"),
  path.join("scripts", "migrate-library-content-dev-to-prod"),
  path.join("scripts", "rename-prod-users-to-admin-users"),
];

/**
 * The rules suites' own `p("collection/id")` helper, which runs a
 * slash-joined path's first segment through tenantPath. Matched only in a
 * file that DEFINES it that way - `p` is far too short a name to treat as a
 * seam call everywhere, and a check that quietly ignores a one-letter
 * function is a check with a hole in it.
 */
const P_DEF = "tenantPath\\(s\\.slice\\(0, i\\)\\)";
const P_HELPER_CALL =
  new RegExp(`(?<=${P_DEF}[\\s\\S]*)p\\(\\s*['"\`][^'"\`]*['"\`]\\s*\\)`, "g");

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
        .replace(/triggerPath\(\s*['"`][^'"`]+['"`][^)]*\)/g, "SEAMED")
        // The rules suites define a local `p()` that runs a slash-joined
        // path's first segment through tenantPath. Stripped ONLY in files
        // that actually define it that way - `p` is far too short a name to
        // treat as a seam call everywhere, and a check that quietly ignores
        // a one-letter function is a check with a hole in it.
        .replace(P_HELPER_CALL, "SEAMED")
        // COMMENTS ARE NOT PATHS. Prose routinely quotes the very call it is
        // describing - "paged rather than one unbounded
        // libraryDb.collection('libraryUsers')" - and flagging that teaches
        // people the check cries wolf. Only whole comment LINES are dropped,
        // never a trailing `//` inside a line, which could hide real code
        // sitting before it on the same line.
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join("\n");

      for (const name of TENANT_COLLECTIONS) {
        // The shapes that actually reach Firestore. A collection named in a
        // COMMENT or in unrelated prose is not a path, and flagging it would
        // make this check noise.
        // The name, quoted - either on its own or as the first segment of a
        // slash-joined path. THAT SECOND FORM was a blind spot until Wave 3:
        // the rules suites write `doc(db, "libraryUsers/patron@test.local")`,
        // one string, and a pattern looking for a quoted bare name cannot
        // see it. It cost the licence paywall a silent failure - the fixture
        // seeded the old path, hasBookLicense() looked at the new one, and a
        // patron was refused a book they owned.
        const q = `['"\`]${name}(/[^'"\`]*)?['"\`]`;
        const patterns = [
          // collection(firestore, 'config') / doc(db, "config/x")
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
