"use strict";
// The authorization decisions behind emailing a lesson and starting a group.
// Both were inline in their callables and therefore untestable without an
// emulator; pulled out here because a quiet change to either is the kind of
// bug that only shows up as someone receiving content they never bought.
const test = require("node:test");
const assert = require("node:assert");

const {
  mayReadBook,
  mayCreateGroupForBook,
  mayLeadGroups,
} = require("../lib/library-access");

test("mayReadBook: a patron reads a book on their own licence list", () => {
  assert.equal(mayReadBook({licensedBookIds: ["b1", "b2"]}, "b1"), true);
});

test("mayReadBook: and is refused one that is not", () => {
  // The whole point of the check - emailLessonPdf runs with admin credentials
  // and would otherwise mail any lesson in the library to any account holder.
  assert.equal(mayReadBook({licensedBookIds: ["b1"]}, "b2"), false);
});

test("mayReadBook: staff carry \"all\" rather than a list", () => {
  assert.equal(mayReadBook({licensedBookIds: "all"}, "anything"), true);
});

test("mayReadBook: an international patron reads every book", () => {
  // They are never asked to pay, so they hold no licences to check.
  assert.equal(
    mayReadBook({licensedBookIds: [], internationalUser: true}, "b9"),
    true
  );
});

test("mayReadBook: a profile with nothing on it is refused", () => {
  assert.equal(mayReadBook({}, "b1"), false);
  assert.equal(mayReadBook({licensedBookIds: null}, "b1"), false);
});

test("mayReadBook: internationalUser must be exactly true", () => {
  // A stray truthy value in the data must not open the library.
  assert.equal(
    mayReadBook({licensedBookIds: [], internationalUser: "yes"}, "b1"),
    false
  );
});

test("mayCreateGroupForBook: needs a licence for that book", () => {
  assert.equal(mayCreateGroupForBook({licensedBookIds: ["b1"]}, "b1"), true);
  assert.equal(mayCreateGroupForBook({licensedBookIds: ["b1"]}, "b2"), false);
});

test("mayCreateGroupForBook: an international patron may", () => {
  assert.equal(
    mayCreateGroupForBook({licensedBookIds: [], internationalUser: true}, "b1"),
    true
  );
});

test("mayCreateGroupForBook: staff get NO bypass, unlike reading", () => {
  // Deliberate, and the one place these two rules part company: reading a
  // patron's book as staff is routine, creating a patron-facing group as
  // staff is not. Matches the pre-consolidation rules' create gate.
  assert.equal(mayReadBook({licensedBookIds: "all"}, "b1"), true);
  assert.equal(mayCreateGroupForBook({licensedBookIds: "all"}, "b1"), false);
});

test("mayLeadGroups: absent means allowed", () => {
  // Profiles written before the field existed must not lose something they
  // could do yesterday.
  assert.equal(mayLeadGroups({}), true);
  assert.equal(mayLeadGroups({canLeadGroups: undefined}), true);
});

test("mayLeadGroups: true means allowed", () => {
  assert.equal(mayLeadGroups({canLeadGroups: true}), true);
});

test("mayLeadGroups: ONLY an explicit false withholds it", () => {
  assert.equal(mayLeadGroups({canLeadGroups: false}), false);
});

test("mayLeadGroups: a non-boolean does not withhold it", () => {
  // Guards against this ever being rewritten as `=== true`, which would lock
  // out every profile the backfill has not reached.
  assert.equal(mayLeadGroups({canLeadGroups: "false"}), true);
  assert.equal(mayLeadGroups({canLeadGroups: 0}), true);
});
