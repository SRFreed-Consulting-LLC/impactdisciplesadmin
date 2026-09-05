// THE `biz` CLAIM, AND THE LIST IT IS DERIVED FROM.
//
// Rules can read custom claims and nothing else, so a per-screen grant -
// which lives in an admin_users document - has never been visible to them.
// firestore.rules said so in its own header and accepted the consequence
// (sweep S2, 2026-08-28): ANY Employee, including one holding no grants at
// all, could read the whole customer database from devtools.
//
// hasBusinessAccess() is what closes that. It derives ONE boolean - "was this
// person deliberately given some business access" - which the trigger stamps
// as a claim and the rules can then check.
//
// TWO THINGS THIS FILE GUARDS:
//
//   1. The BUSINESS_GROUPS list is a hand-copy of the ADMIN-tab groups in
//      src/app/core/main-screen/nav-config.ts, because functions/ cannot
//      import src/app. A copy nothing compares is a copy that WILL drift, and
//      the drift is silent in the dangerous direction: a group added to the
//      nav but not here means an Employee granted that screen is refused the
//      data behind it, and one removed from the nav but left here means an
//      Employee keeps access to data whose screen no longer exists.
//   2. The predicate itself - who gets the claim and who does not.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const {hasBusinessAccess} = require("../lib/admin-claims.functions");

const NAV_CONFIG = path.join(
  __dirname, "..", "..", "src", "app", "core", "main-screen", "nav-config.ts");

/**
 * Every group id in nav-config, with the NavSection it declares.
 *
 * Parsed rather than imported for the same reason the list is copied at all.
 * A group with no `section:` before the next group starts is 'admin', which
 * is nav-config's own documented default.
 * @return {Map<string, string>} group id -> section.
 */
function navGroups() {
  const src = fs.readFileSync(NAV_CONFIG, "utf8");
  const groups = new Map();
  // Only top-level group declarations - four-space indent inside NAV_CONFIG.
  const ids = [...src.matchAll(/^ {4}id: '([a-z-]+)',$/gm)];
  ids.forEach((m, i) => {
    const start = m.index;
    const end = i + 1 < ids.length ? ids[i + 1].index : src.length;
    const body = src.slice(start, end);
    const section = /^ {4}section: '([a-z]+)'/m.exec(body);
    groups.set(m[1], section ? section[1] : "admin");
  });
  return groups;
}

test("the copied group list still matches nav-config's admin tab", () => {
  const groups = navGroups();
  assert.ok(groups.size >= 10,
    `parsed only ${groups.size} nav groups - the file's shape changed and ` +
    "this parser needs fixing rather than trusting");

  const expected = [...groups]
    .filter(([, section]) => section === "admin")
    .map(([id]) => id)
    .sort();

  // Read the copy out of the compiled function rather than re-listing it
  // here, which would just be a third copy to keep in step.
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src", "admin-claims.functions.ts"), "utf8");
  const block = /const BUSINESS_GROUPS = \[([\s\S]*?)\];/.exec(src);
  assert.ok(block, "BUSINESS_GROUPS is no longer a plain array literal");
  const actual = [...block[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]).sort();

  assert.deepEqual(actual, expected,
    "BUSINESS_GROUPS has drifted from nav-config's ADMIN-tab groups. A group " +
    "missing here denies an Employee data whose screen they were granted; a " +
    "group left here keeps access to data whose screen is gone.");
});

test("Admin and Root always have it, grants or no grants", () => {
  assert.equal(hasBusinessAccess("Admin", undefined), true);
  assert.equal(hasBusinessAccess("Root", []), true);
  // isFullAccess() in the app says the same - Root inherits Admin - so the
  // claim must not be the one place that disagrees.
  assert.equal(hasBusinessAccess("Admin", null), true);
});

test("an Employee with no grants does NOT", () => {
  // The whole point. This is a real account in production today.
  assert.equal(hasBusinessAccess("Employee", []), false);
  assert.equal(hasBusinessAccess("Employee", undefined), false);
  assert.equal(hasBusinessAccess("Employee", null), false);
});

test("an Employee granted only a SITE page does NOT", () => {
  // Also a real production account: one Employee administers a single page
  // and nothing else. They must keep that page and gain nothing else.
  assert.equal(
    hasBusinessAccess("Employee", [
      {screenKey: "page-manager.coaching-with-impact", view: true, edit: true},
    ]),
    false);
});

test("an Employee granted a business screen DOES", () => {
  assert.equal(
    hasBusinessAccess("Employee", [{screenKey: "contacts-manager.contacts"}]),
    true);
  // A group-level key, not just a leaf.
  assert.equal(
    hasBusinessAccess("Employee", [{screenKey: "reports-manager"}]),
    true);
});

test("a prefix that merely starts the same way does not count", () => {
  // "page-manager" must never satisfy a check for "admin-manager", and a
  // group id that is a prefix of another must not leak across.
  assert.equal(
    hasBusinessAccess("Employee", [{screenKey: "contacts-manager-extra.x"}]),
    false);
});

test("an Editor never has it, whatever their document says", () => {
  // Editors are hard-scoped to the Library everywhere else. A stray
  // Employee-style grants array on an Editor's doc must not be a way in.
  assert.equal(
    hasBusinessAccess("Editor", [{screenKey: "contacts-manager.contacts"}]),
    false);
  assert.equal(hasBusinessAccess("Customer", [{screenKey: "store-manager"}]),
    false);
  assert.equal(hasBusinessAccess(undefined, [{screenKey: "store-manager"}]),
    false);
});

test("a malformed grants array cannot grant anything", () => {
  // These documents are edited by hand in a Permissions tab; a shape nobody
  // expected must fail closed.
  assert.equal(hasBusinessAccess("Employee", "contacts-manager"), false);
  assert.equal(hasBusinessAccess("Employee", [null, 3, "x"]), false);
  assert.equal(hasBusinessAccess("Employee", [{}]), false);
  assert.equal(hasBusinessAccess("Employee", [{screenKey: 42}]), false);
});
