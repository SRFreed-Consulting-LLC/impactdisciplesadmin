// Unit tests for the public Impact Group finder's projection and filters.
//
// The privacy assertions here are the important ones. search_impact_groups
// is anonymous and its output is meant to be indexable, so a field that
// leaks once is public permanently. onlineInfo in particular holds meeting
// links and passwords in practice - publishing it would hand anyone a way
// into a private meeting.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {
  meetingTypeOf,
  leaderLabel,
  distanceMiles,
  isPubliclyListed,
  toPublicSummary,
  matchesText,
} = require("../lib/library-groups-public.functions");

const stateName = (code) => ({GA: "Georgia", TX: "Texas"}[code]);

// A deliberately maximal group: every sensitive field populated, so the
// projection has something to leak if it is going to.
const sensitiveGroup = {
  title: "Tuesday Morning Disciple-Makers",
  description: "We meet before work.",
  bookId: "book-1",
  creatorEmail: "matthew.frady@example.com",
  creatorDisplayName: "Matthew Frady",
  onlineInfo: "https://zoom.us/j/123456789 passcode: hunter2",
  location: {
    country: "US", state: "GA", city: "Duluth", locationType: "private",
    address1: "1234 Main Street", addressVisible: false,
    lat: 34.0029, lng: -84.1446,
  },
  startDate: 1789000000000,
  startTimeZone: "America/New_York",
  status: "open",
  maxMembers: 12,
  memberCount: 10,
  pendingCount: 3,
};

test("the projection never carries onlineInfo", () => {
  const s = toPublicSummary("g1", sensitiveGroup, "Making of a Disciple-Maker");
  assert.equal("onlineInfo" in s, false);
  // Belt and braces: the passcode must not have reached ANY field.
  assert.equal(JSON.stringify(s).includes("hunter2"), false);
  assert.equal(JSON.stringify(s).includes("zoom.us"), false);
});

test("the projection never carries creator email or internal counts", () => {
  const s = toPublicSummary("g1", sensitiveGroup);
  assert.equal("creatorEmail" in s, false);
  assert.equal("pendingCount" in s, false);
  assert.equal("memberCount" in s, false);
  assert.equal(JSON.stringify(s).includes("@example.com"), false);
});

test("a hidden address is withheld but its coordinates are kept", () => {
  // addressVisible false is the leader's recorded choice and must be
  // honoured; lat/lng are stored precisely so distance search still works.
  const s = toPublicSummary("g1", sensitiveGroup);
  assert.equal("address1" in s, false);
  assert.equal(s.city, "Duluth");
  assert.equal(s.lat, 34.0029);
  assert.equal(s.lng, -84.1446);
});

test("a visible address is published", () => {
  const g = {
    ...sensitiveGroup,
    location: {...sensitiveGroup.location, addressVisible: true},
  };
  assert.equal(toPublicSummary("g1", g).address1, "1234 Main Street");
});

test("legacy inPersonLocation is never used as an address fallback", () => {
  // That legacy free text is unstructured and frequently a full street
  // address, with no visibility flag attached to it - so it must not slip
  // out through the address field.
  const g = {
    title: "Legacy", bookId: "b", status: "open", startDate: 1,
    creatorDisplayName: "Dana Reynolds",
    inPersonLocation: "First Baptist, 55 Oak St, Suwanee GA",
  };
  const s = toPublicSummary("g2", g);
  assert.equal("address1" in s, false);
  assert.equal(JSON.stringify(s).includes("55 Oak St"), false);
});

test("leaderLabel reduces a name to first name + last initial", () => {
  assert.equal(leaderLabel("Matthew Frady"), "Matthew F.");
  assert.equal(leaderLabel("  Dana   Reynolds  "), "Dana R.");
  assert.equal(leaderLabel("Maria de la Cruz"), "Maria C.");
});

test("leaderLabel never publishes an email or an empty name", () => {
  // createGroup falls back to the caller's email when no display name was
  // given, so an address genuinely reaches this field.
  assert.equal(leaderLabel("matthew@example.com"), "An Impact Group leader");
  assert.equal(leaderLabel(""), "An Impact Group leader");
  assert.equal(leaderLabel("   "), "An Impact Group leader");
  assert.equal(leaderLabel(undefined), "An Impact Group leader");
  assert.equal(leaderLabel(42), "An Impact Group leader");
});

test("leaderLabel keeps a single-token name as-is", () => {
  assert.equal(leaderLabel("Matthew"), "Matthew");
});

test("isPubliclyListed excludes closed and invite-only groups", () => {
  assert.equal(isPubliclyListed({status: "open"}), true);
  assert.equal(isPubliclyListed({status: "closed"}), false);
  assert.equal(
    isPubliclyListed({status: "open", groupVisibility: "invite-only"}), false);
  // Absent visibility means public - testing !== 'public' would wrongly
  // hide every group created before the field existed.
  assert.equal(
    isPubliclyListed({status: "open", groupVisibility: undefined}), true);
  assert.equal(
    isPubliclyListed({status: "open", groupVisibility: "public"}), true);
});

test("meetingTypeOf derives from which location fields exist", () => {
  assert.equal(meetingTypeOf({location: {}}), "in-person");
  assert.equal(meetingTypeOf({inPersonLocation: "Church"}), "in-person");
  assert.equal(meetingTypeOf({onlineInfo: "Zoom"}), "online");
  assert.equal(meetingTypeOf({location: {}, onlineInfo: "Zoom"}), "hybrid");
  assert.equal(meetingTypeOf({}), "none");
});

test("a group with no location signal is surfaced as in-person", () => {
  // 'none' is not a public meeting type. Groups written while the
  // createGroup location bug was live have no signal at all, and they are
  // overwhelmingly in-person - see scripts/audit-group-locations.js.
  const s = toPublicSummary("g3", {
    title: "Lost Location", bookId: "b", status: "open", startDate: 1,
    creatorDisplayName: "Sam Patel",
  });
  assert.equal(s.meetingType, "in-person");
});

test("spotsLeft backs the creator out of the member count", () => {
  // maxMembers excludes the creator; memberCount includes them.
  // 12 cap, 10 members (creator + 9 approved) -> 3 spots left.
  assert.equal(toPublicSummary("g1", sensitiveGroup).spotsLeft, 3);
});

test("spotsLeft is absent when the group has no cap", () => {
  const {maxMembers, ...uncapped} = sensitiveGroup;
  void maxMembers;
  assert.equal("spotsLeft" in toPublicSummary("g1", uncapped), false);
});

test("spotsLeft never goes negative", () => {
  const over = {...sensitiveGroup, maxMembers: 2, memberCount: 9};
  assert.equal(toPublicSummary("g1", over).spotsLeft, 0);
});

test("matchesText searches title, city, state code and state name", () => {
  const s = toPublicSummary("g1", sensitiveGroup, "Making of a Disciple-Maker");
  assert.equal(matchesText(s, "tuesday", stateName), true);
  assert.equal(matchesText(s, "duluth", stateName), true);
  assert.equal(matchesText(s, "ga", stateName), true);
  // The point of the state-name lookup: a searcher types "Georgia", the
  // document stores "GA".
  assert.equal(matchesText(s, "georgia", stateName), true);
  assert.equal(matchesText(s, "disciple-maker", stateName), true);
  assert.equal(matchesText(s, "nashville", stateName), false);
});

test("matchesText cannot be used to probe a withheld address", () => {
  // The haystack is built from the PROJECTION, not the document, so a
  // hidden address is not searchable either - otherwise search results
  // would confirm an address the leader chose to hide.
  const s = toPublicSummary("g1", sensitiveGroup);
  assert.equal(matchesText(s, "1234 main", stateName), false);
});

test("an empty query matches everything", () => {
  const s = toPublicSummary("g1", sensitiveGroup);
  assert.equal(matchesText(s, "", stateName), true);
});

test("distanceMiles is accurate over a known pair", () => {
  // Duluth GA -> Suwanee GA, roughly 5 miles.
  const d = distanceMiles(34.0029, -84.1446, 34.0515, -84.0713);
  assert.ok(d > 4 && d < 6, `expected ~5mi, got ${d}`);
  assert.equal(distanceMiles(34, -84, 34, -84), 0);
});

test("distanceMiles matches a long known distance", () => {
  // Atlanta -> Nashville is about 214 miles great-circle.
  const d = distanceMiles(33.749, -84.388, 36.1627, -86.7816);
  assert.ok(d > 205 && d < 225, `expected ~214mi, got ${d}`);
});
