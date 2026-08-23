// Policy tests for what survives an Impact Group deletion.
//
// Background: admin's deleteGroup cascade walks only what lives UNDER the
// group document. groupInvites and groupLicenses are top-level collections
// carrying the group id in a field, so nothing cleaned them up - leaving
// pending invites as live bearer links to nothing, and assigned licenses
// pointing at a group that no longer exists.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {
  shouldDeleteInviteOnGroupDelete,
  shouldDetachLicense,
} = require("../lib/library-group-cleanup.functions");

test("a pending invite is deleted with its group", () => {
  // Its doc id IS the bearer token in the emailed link, so leaving it
  // behind leaves a live link to a group that no longer exists.
  assert.equal(shouldDeleteInviteOnGroupDelete("pending"), true);
});

test("accepted and declined invites are kept as history", () => {
  // Both are immutable records, and they carry a denormalized groupTitle,
  // so a leader's sent-invites list still renders them after the group is
  // gone. Neither is actionable, so neither is a dead link.
  assert.equal(shouldDeleteInviteOnGroupDelete("accepted"), false);
  assert.equal(shouldDeleteInviteOnGroupDelete("declined"), false);
});

test("an unrecognised or missing invite status is left alone", () => {
  // Deleting is irreversible; anything this policy does not positively
  // recognise as pending stays put.
  assert.equal(shouldDeleteInviteOnGroupDelete(undefined), false);
  assert.equal(shouldDeleteInviteOnGroupDelete(null), false);
  assert.equal(shouldDeleteInviteOnGroupDelete(""), false);
  assert.equal(shouldDeleteInviteOnGroupDelete("PENDING"), false);
});

test("an assigned license tied to the group is flagged", () => {
  assert.equal(shouldDetachLicense({
    status: "assigned",
    assignedGroupId: "g1",
    assignedToEmail: "member@example.com",
  }), true);
});

test("an unassigned license is untouched - it is a leader reserve", () => {
  // The whole point of groupLicenses being top-level: an unassigned unit
  // belongs to the LEADER, scoped only by bookId, and is reusable across
  // any of their groups including ones created later. It was never tied to
  // the deleted group, so it is not orphaned by the delete.
  assert.equal(shouldDetachLicense({
    status: "unassigned",
    leaderEmail: "leader@example.com",
    bookId: "book-1",
  }), false);
});

test("an assigned license with no group id is not flagged", () => {
  // Inconsistent shape - flagging it would claim a tie to this group that
  // the document does not actually record.
  assert.equal(shouldDetachLicense({status: "assigned"}), false);
  assert.equal(
    shouldDetachLicense({status: "assigned", assignedGroupId: ""}), false);
});

test("the flag marks; it never revokes", () => {
  // Documented here because it is a product decision, not an implementation
  // detail: revoking strips the book from the recipient's libraryUsers
  // grant. Staff deleting a group is moderation the recipient had no part
  // in, so silently taking away a book they are reading would be worse than
  // a stale pointer. The flag exists so revokeGroupLicense can let the
  // LEADER reclaim the unit as a deliberate act instead.
  const license = {status: "assigned", assignedGroupId: "g1"};
  assert.equal(shouldDetachLicense(license), true);
  // The policy function reports only; it must not mutate the input.
  assert.deepEqual(license, {status: "assigned", assignedGroupId: "g1"});
});
