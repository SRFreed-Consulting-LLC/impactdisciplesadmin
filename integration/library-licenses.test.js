const {tenantPath} = require("../scripts/lib/tenancy");
// Integration: library license lifecycle through the REAL Cloud Functions
// in the emulator - the onPurchaseGrantLibraryLicenses purchases trigger
// (library-license-grant.functions.ts / library-store-license-grant.ts)
// and the staff callables in library-users.functions.ts
// (grantLibraryUserLicenses / revokeAdminGrantedLicense /
// setLibraryUserRevoked).
// Charter area: Store <-> Library seam - who holds which book license,
// with per-source provenance (store-purchase vs admin-grant) and
// independent revocation per source.
const {test, before} = require("node:test");
const assert = require("node:assert/strict");
const {getAuth, getApp, getDb, preflight, reseed, callCallable, signIn,
  waitFor} = require("./helpers/emulator");

const PATRON = "patron@test.local";
const PATRON_UID = "patron-uid-0001";
const BOOK1 = "lib-book-0001";
const BOOK2 = "lib-book-0002";

let db;
let adminToken;

const libUser = async (email) =>
  (await db.collection(tenantPath("libraryUsers")).doc(email).get()).data();
const entriesFor = (user, bookId) =>
  (user.bookLicenses ?? []).filter((l) => l.bookId === bookId);

const digitalPurchase = (email, extra = {}) => ({
  email,
  firstName: "Reader", lastName: "Test",
  cartItems: [{
    id: "prod-book-digital", isDigitalBook: true,
    digitalBookId: BOOK1, orderQuantity: 1,
  }],
  dateProcessed: new Date(),
  ...extra,
});

before(async () => {
  await preflight();
  reseed();
  db = getDb();
  adminToken = await signIn("admin@test.local");
});

test("a digital-book purchase grants the license: libraryUsers/{email} " +
  "created with the flat id and a source:'store-purchase' entry", async () => {
  await db.collection(tenantPath("purchases")).doc("lib-purch-0001").set(
    digitalPurchase("NewReader@Library.TEST", {
      cartItems: [{
        id: "prod-book-digital", isDigitalBook: true,
        digitalBookId: BOOK1, orderQuantity: 1, language: "en",
      }],
    })
  );

  // Doc id = lowercased email (the reader app's convention).
  const user = await waitFor(() => libUser("newreader@library.test"),
    {timeoutMs: 60000, intervalMs: 1000, label: "store-purchase grant"});
  assert.deepEqual(user.licensedBookIds, [BOOK1]);
  assert.equal(user.email, "newreader@library.test");
  assert.equal(user.bookLicenses.length, 1);
  const license = user.bookLicenses[0];
  assert.equal(license.bookId, BOOK1);
  assert.equal(license.source, "store-purchase");
  assert.equal(license.storePurchaseId, "lib-purch-0001");
  assert.equal(license.language, "en");
  assert.ok(typeof license.purchaseDate === "number");
  assert.ok(user.createdAt);
});

test("a replayed delivery of the SAME purchase re-grants nothing " +
  "(idempotent on purchaseId+bookId), while a DIFFERENT purchase of the " +
  "same book adds its own provenance entry", async () => {
  // Replay: delete + recreate the same doc id refires onCreate with the
  // same purchaseId (purchases has no delete trigger, verified in
  // functions/src/index.ts). A sentinel purchase created afterwards
  // proves the trigger queue drained past the replay.
  await db.collection(tenantPath("purchases")).doc("lib-purch-0001").delete();
  await db.collection(tenantPath("purchases")).doc("lib-purch-0001").set(
    digitalPurchase("newreader@library.test"));
  await db.collection(tenantPath("purchases")).doc("lib-purch-sentinel").set(
    digitalPurchase("sentinel-reader@library.test"));
  await waitFor(() => libUser("sentinel-reader@library.test"),
    {timeoutMs: 60000, intervalMs: 1000, label: "sentinel grant"});

  let user = await libUser("newreader@library.test");
  assert.equal(user.bookLicenses.length, 1, "replay must not stack entries");
  assert.deepEqual(user.licensedBookIds, [BOOK1]);

  // Different purchase, same book: a new entry with its own
  // storePurchaseId (each provenance is revoked independently); the flat
  // id list stays deduped.
  await db.collection(tenantPath("purchases")).doc("lib-purch-0002").set(
    digitalPurchase("newreader@library.test"));
  user = await waitFor(async () => {
    const u = await libUser("newreader@library.test");
    return u.bookLicenses.length === 2 ? u : null;
  }, {timeoutMs: 60000, intervalMs: 1000, label: "second-purchase entry"});
  assert.deepEqual(user.licensedBookIds, [BOOK1]);
  assert.deepEqual(
    user.bookLicenses.map((l) => l.storePurchaseId).sort(),
    ["lib-purch-0001", "lib-purch-0002"]);
});

test("grantLibraryUserLicenses adds an admin-grant entry, skips " +
  "already-covered books, and rejects unknown book ids", async () => {
  const res = await callCallable("grantLibraryUserLicenses",
    {email: "Patron@Test.Local", bookIds: [BOOK2]}, adminToken);
  assert.equal(res.status, 200, JSON.stringify(res.error));
  assert.deepEqual(res.result, {granted: [BOOK2], skipped: []});

  const user = await libUser(PATRON);
  assert.deepEqual([...user.licensedBookIds].sort(), [BOOK1, BOOK2]);
  const entry = entriesFor(user, BOOK2)[0];
  assert.equal(entry.source, "admin-grant");
  assert.equal(entry.grantedBy, "admin-uid-0001");

  // Already covered -> skipped, never a duplicate entry.
  const again = await callCallable("grantLibraryUserLicenses",
    {email: PATRON, bookIds: [BOOK2]}, adminToken);
  assert.deepEqual(again.result, {granted: [], skipped: [BOOK2]});
  assert.equal(entriesFor(await libUser(PATRON), BOOK2).length, 1);

  // Unknown book id -> not-found, nothing granted.
  const unknown = await callCallable("grantLibraryUserLicenses",
    {email: PATRON, bookIds: ["lib-book-nope"]}, adminToken);
  assert.equal(unknown.error.status, "NOT_FOUND");
});

test("revokeAdminGrantedLicense drops the flat id only when NO other " +
  "source still covers the book", async () => {
  // Construct dual-source coverage first: patron holds BOOK1 via the
  // seeded admin-grant; add a store purchase of the same book.
  await db.collection(tenantPath("purchases")).doc("lib-purch-patron").set(
    digitalPurchase(PATRON));
  await waitFor(async () => {
    const u = await libUser(PATRON);
    return entriesFor(u, BOOK1).some((l) => l.source === "store-purchase") ?
      u : null;
  }, {timeoutMs: 60000, intervalMs: 1000, label: "patron store-purchase entry"});

  // BOOK2 is covered by the admin grant alone: revoking it removes both
  // the entry AND the flat id.
  const revoke2 = await callCallable("revokeAdminGrantedLicense",
    {email: PATRON, bookId: BOOK2}, adminToken);
  assert.deepEqual(revoke2.result, {removed: true});
  let user = await libUser(PATRON);
  assert.ok(!user.licensedBookIds.includes(BOOK2));
  assert.equal(entriesFor(user, BOOK2).length, 0);

  // BOOK1 is covered by admin-grant AND store-purchase: revoking removes
  // only the admin-grant entry - the flat id SURVIVES because the
  // purchase provenance still covers it.
  const revoke1 = await callCallable("revokeAdminGrantedLicense",
    {email: PATRON, bookId: BOOK1}, adminToken);
  assert.deepEqual(revoke1.result, {removed: true});
  user = await libUser(PATRON);
  assert.deepEqual(user.licensedBookIds, [BOOK1]); // kept
  const remaining = entriesFor(user, BOOK1);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].source, "store-purchase");

  // No admin-grant entry left for BOOK1 -> removed:false, no change (a
  // store-purchase license is NOT this function's to revoke).
  const noop = await callCallable("revokeAdminGrantedLicense",
    {email: PATRON, bookId: BOOK1}, adminToken);
  assert.deepEqual(noop.result, {removed: false});
  assert.deepEqual((await libUser(PATRON)).licensedBookIds, [BOOK1]);
});

test("setLibraryUserRevoked disables/re-enables the Auth account and " +
  "stamps/clears the doc flags", async () => {
  const auth = getAuth(getApp());

  const revoke = await callCallable("setLibraryUserRevoked",
    {email: PATRON, revoked: true}, adminToken);
  assert.equal(revoke.status, 200, JSON.stringify(revoke.error));
  assert.deepEqual(revoke.result,
    {email: PATRON, revoked: true, authAccountFound: true});
  let user = await libUser(PATRON);
  assert.equal(user.revoked, true);
  assert.ok(typeof user.revokedAt === "number");
  assert.equal(user.revokedBy, "admin-uid-0001");
  assert.equal((await auth.getUser(PATRON_UID)).disabled, true);

  const restore = await callCallable("setLibraryUserRevoked",
    {email: PATRON, revoked: false}, adminToken);
  assert.deepEqual(restore.result,
    {email: PATRON, revoked: false, authAccountFound: true});
  user = await libUser(PATRON);
  assert.equal(user.revoked, false);
  assert.equal(user.revokedAt, undefined); // FieldValue.delete()d
  assert.equal(user.revokedBy, undefined);
  assert.equal((await auth.getUser(PATRON_UID)).disabled, false);

  // Unknown library user -> not-found, before any Auth mutation.
  const unknown = await callCallable("setLibraryUserRevoked",
    {email: "nobody@library.test", revoked: true}, adminToken);
  assert.equal(unknown.error.status, "NOT_FOUND");
});

test("the callables require the Admin ROLE - staff membership alone " +
  "(Employee) is not enough, and unauthenticated is rejected", async () => {
  const anon = await callCallable("grantLibraryUserLicenses",
    {email: PATRON, bookIds: [BOOK2]});
  assert.equal(anon.error.status, "UNAUTHENTICATED");

  // employee@test.local exists in admin_users (role Employee, store-only
  // permissions) - requireAdminRole checks role === Admin|Root, so the
  // grant is refused regardless of screen permissions.
  const employeeToken = await signIn("employee@test.local");
  for (const [fn, data] of [
    ["grantLibraryUserLicenses", {email: PATRON, bookIds: [BOOK2]}],
    ["revokeAdminGrantedLicense", {email: PATRON, bookId: BOOK1}],
    ["setLibraryUserRevoked", {email: PATRON, revoked: true}],
  ]) {
    const res = await callCallable(fn, data, employeeToken);
    assert.equal(res.error.status, "PERMISSION_DENIED",
      `${fn} must refuse Employee-role staff`);
  }

  // And the world is untouched by the refused calls.
  const user = await libUser(PATRON);
  assert.equal(user.revoked, false);
  assert.ok(!user.licensedBookIds.includes(BOOK2));
});
