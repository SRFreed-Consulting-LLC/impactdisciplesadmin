// The group-license entitlement lifecycle: grant, revoke, and roster copy.
//
// Why this suite matters: these three helpers write into a patron's own
// `libraryUsers/{email}` document, which firestore.rules blocks every
// client from touching - including the leader's. That makes them the only
// thing standing between a leader's action and another person's paid book
// access, and none of them had a test.
//
// All three take their Firestore handles as PARAMETERS (a transaction and
// document refs), which is what lets this run with no emulator and no
// Firebase app: the fakes below just record what would have been written.
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {FieldValue} = require("firebase-admin/firestore");

const {applyLicenseGrant} = require("../lib/library-group-license-grant");
const {applyLicenseRevoke} = require("../lib/library-group-license-revoke");
const {selectMembersToCopy} = require("../lib/library-group-members-copy");

const NOW = Date.UTC(2026, 7, 24, 9, 0, 0);

/** Records set/update calls instead of performing them. */
function fakeTransaction() {
  const calls = {sets: [], updates: []};
  return {
    calls,
    set(ref, data, options) {
      calls.sets.push({ref: ref.id, data, options});
    },
    update(ref, data) {
      calls.updates.push({ref: ref.id, data});
    },
  };
}

const ref = (id) => ({id});

/** A libraryUsers snapshot, or a missing one when data is undefined. */
function snap(data) {
  return {exists: data !== undefined, data: () => data};
}

const grantParams = (overrides = {}) => ({
  transaction: overrides.transaction,
  licenseRef: ref("lic-1"),
  recipientRef: ref("member@example.com"),
  recipientSnap: snap(undefined),
  bookId: "book-1",
  licenseId: "lic-1",
  groupId: "grp-1",
  recipientEmail: "member@example.com",
  now: NOW,
  ...overrides,
});

// ----------------------------------------------------------------- grant

test("granting a license writes the book onto the recipient", () => {
  const tx = fakeTransaction();
  applyLicenseGrant(grantParams({transaction: tx}));

  const write = tx.calls.sets[0];
  assert.equal(write.ref, "member@example.com");
  assert.deepEqual(write.options, {merge: true});
  assert.equal(write.data.email, "member@example.com");
  assert.deepEqual(write.data.licensedBookIds, ["book-1"]);
  assert.deepEqual(write.data.bookLicenses, [{
    bookId: "book-1",
    purchaseDate: NOW,
    source: "group-license",
    groupLicenseId: "lic-1",
  }]);
});

test("granting marks the unit assigned to that group and person", () => {
  const tx = fakeTransaction();
  applyLicenseGrant(grantParams({transaction: tx}));

  assert.deepEqual(tx.calls.updates[0], {
    ref: "lic-1",
    data: {
      status: "assigned",
      assignedGroupId: "grp-1",
      assignedToEmail: "member@example.com",
      assignedAt: NOW,
    },
  });
});

test("a brand-new recipient gets createdAt; an existing one does not", () => {
  const fresh = fakeTransaction();
  applyLicenseGrant(grantParams({transaction: fresh}));
  assert.equal(fresh.calls.sets[0].data.createdAt, NOW,
    "a first-time recipient needs createdAt");

  const existing = fakeTransaction();
  applyLicenseGrant(grantParams({
    transaction: existing,
    recipientSnap: snap({licensedBookIds: [], bookLicenses: []}),
  }));
  assert.equal("createdAt" in existing.calls.sets[0].data, false,
    "an existing patron's createdAt must not be rewritten");
});

test("re-granting the same book replaces, never duplicates", () => {
  // Otherwise a re-assignment leaves two bookLicenses rows for one book and
  // revoking one of them would leave the other behind, silently keeping
  // access alive.
  const tx = fakeTransaction();
  applyLicenseGrant(grantParams({
    transaction: tx,
    recipientSnap: snap({
      licensedBookIds: ["book-1"],
      bookLicenses: [{
        bookId: "book-1",
        source: "group-license",
        groupLicenseId: "older-lic",
      }],
    }),
  }));

  const data = tx.calls.sets[0].data;
  assert.equal(data.bookLicenses.length, 1);
  assert.equal(data.bookLicenses[0].groupLicenseId, "lic-1");
  assert.deepEqual(data.licensedBookIds, ["book-1"], "no duplicate id");
});

test("granting preserves the recipient's other books", () => {
  const tx = fakeTransaction();
  applyLicenseGrant(grantParams({
    transaction: tx,
    recipientSnap: snap({
      licensedBookIds: ["other-book"],
      bookLicenses: [{bookId: "other-book", source: "store"}],
    }),
  }));

  const data = tx.calls.sets[0].data;
  assert.deepEqual(data.licensedBookIds.sort(), ["book-1", "other-book"]);
  assert.equal(data.bookLicenses.length, 2);
});

test("granting never writes userId onto the recipient", () => {
  // That field must only ever reflect the RECIPIENT's own Auth uid, never
  // whoever triggered the grant - the module says so explicitly.
  const tx = fakeTransaction();
  applyLicenseGrant(grantParams({transaction: tx}));
  assert.equal("userId" in tx.calls.sets[0].data, false);
});

// ---------------------------------------------------------------- revoke

const revokeParams = (overrides = {}) => ({
  transaction: overrides.transaction,
  licenseRef: ref("lic-1"),
  recipientRef: ref("member@example.com"),
  recipientSnap: snap({
    licensedBookIds: ["book-1"],
    bookLicenses: [{bookId: "book-1", groupLicenseId: "lic-1"}],
  }),
  licenseId: "lic-1",
  bookId: "book-1",
  ...overrides,
});

test("revoking removes the book and frees the unit back to the pool", () => {
  const tx = fakeTransaction();
  applyLicenseRevoke(revokeParams({transaction: tx}));

  const recipient = tx.calls.updates.find(
    (u) => u.ref === "member@example.com");
  assert.deepEqual(recipient.data.bookLicenses, []);
  assert.deepEqual(recipient.data.licensedBookIds, []);

  const unit = tx.calls.updates.find((u) => u.ref === "lic-1");
  assert.equal(unit.data.status, "unassigned");
  for (const field of
    ["assignedGroupId", "assignedToEmail", "assignedAt"]) {
    assert.ok(unit.data[field].isEqual(FieldValue.delete()),
      `${field} must be deleted, not set to null`);
  }
});

test("revoking never takes back a book the patron paid for separately", () => {
  // The important one. Someone can hold a group license AND their own store
  // purchase for the same book; pulling the group unit must not remove the
  // access they bought themselves.
  const tx = fakeTransaction();
  applyLicenseRevoke(revokeParams({
    transaction: tx,
    recipientSnap: snap({
      licensedBookIds: ["book-1"],
      bookLicenses: [
        {bookId: "book-1", groupLicenseId: "lic-1"},
        {bookId: "book-1", source: "store", purchaseId: "their-own"},
      ],
    }),
  }));

  const recipient = tx.calls.updates.find(
    (u) => u.ref === "member@example.com");
  assert.deepEqual(recipient.data.licensedBookIds, ["book-1"],
    "their own purchase must keep the book unlocked");
  assert.equal(recipient.data.bookLicenses.length, 1);
  assert.equal(recipient.data.bookLicenses[0].source, "store");
});

test("revoking only removes the entry for THIS license unit", () => {
  const tx = fakeTransaction();
  applyLicenseRevoke(revokeParams({
    transaction: tx,
    recipientSnap: snap({
      licensedBookIds: ["book-1", "book-2"],
      bookLicenses: [
        {bookId: "book-1", groupLicenseId: "lic-1"},
        {bookId: "book-2", groupLicenseId: "lic-2"},
      ],
    }),
  }));

  const recipient = tx.calls.updates.find(
    (u) => u.ref === "member@example.com");
  assert.deepEqual(recipient.data.licensedBookIds, ["book-2"]);
  assert.equal(recipient.data.bookLicenses.length, 1);
  assert.equal(recipient.data.bookLicenses[0].groupLicenseId, "lic-2");
});

test("revoking still frees the unit when the recipient doc is gone", () => {
  // A deleted patron must not strand a purchased unit as permanently
  // assigned - the leader has to be able to reclaim it.
  const tx = fakeTransaction();
  applyLicenseRevoke(revokeParams({
    transaction: tx,
    recipientSnap: snap(undefined),
  }));

  assert.equal(tx.calls.updates.length, 1, "only the license is touched");
  assert.equal(tx.calls.updates[0].ref, "lic-1");
  assert.equal(tx.calls.updates[0].data.status, "unassigned");
});

// ---------------------------------------------------------- roster copy

const member = (email, status = "approved") =>
  ({email, displayName: email.split("@")[0], status});

test("copying takes the approved members and nobody else", () => {
  const selected = selectMembersToCopy(
    [member("a@x.com"), member("b@x.com", "pending"),
      member("c@x.com", "rejected")],
    new Set(),
    "leader@x.com"
  );
  assert.deepEqual(selected.map((m) => m.email), ["a@x.com"]);
});

test("copying skips the leader and anyone already in the target", () => {
  // The leader is written to the target the normal way at create time, and
  // re-copying an existing member would overwrite their current status.
  const selected = selectMembersToCopy(
    [member("leader@x.com"), member("already@x.com"), member("new@x.com")],
    new Set(["already@x.com"]),
    "leader@x.com"
  );
  assert.deepEqual(selected.map((m) => m.email), ["new@x.com"]);
});

test("an explicit subset narrows the copy further", () => {
  // The reader's "Promote to Next Book" flow lets a leader pick who comes.
  const selected = selectMembersToCopy(
    [member("a@x.com"), member("b@x.com"), member("c@x.com")],
    new Set(),
    "leader@x.com",
    new Set(["a@x.com", "c@x.com"])
  );
  assert.deepEqual(selected.map((m) => m.email), ["a@x.com", "c@x.com"]);
});

test("an omitted subset means everyone; an empty one means nobody", () => {
  const all = [member("a@x.com"), member("b@x.com")];
  assert.equal(
    selectMembersToCopy(all, new Set(), "leader@x.com").length, 2);
  assert.equal(
    selectMembersToCopy(all, new Set(), "leader@x.com", new Set()).length, 0);
});

test("a subset cannot smuggle in someone unapproved or already present", () => {
  // allowedEmails narrows; it must never widen past the other rules.
  const selected = selectMembersToCopy(
    [member("pending@x.com", "pending"), member("already@x.com")],
    new Set(["already@x.com"]),
    "leader@x.com",
    new Set(["pending@x.com", "already@x.com"])
  );
  assert.deepEqual(selected, []);
});
