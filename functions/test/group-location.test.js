// Unit tests for createGroup's structured-location narrowing.
//
// This exists because the narrowing it replaces was silently broken: it
// accepted "public-place"/"home", values no client has ever sent (the
// shared DiscussionGroupLocation model and the create wizard both use
// 'public' | 'private'), so locationType always resolved to undefined and
// the ENTIRE location object was dropped on every create. Every group made
// through the wizard stored no city, state, address or coordinates, and
// both city text search and distance search had nothing to match. The
// rejected-values test below is the regression guard for that.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {normalizeGroupLocation} = require("../lib/library-group-location");

// The real createGroup helper, reproduced: trim, drop empties, slice to max.
const cleanText = (value, max = 4000) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};

const norm = (raw) => normalizeGroupLocation(raw, cleanText);

test("accepts the two locationType values the model actually defines", () => {
  assert.equal(
    norm({country: "US", city: "Duluth", locationType: "public"})
      .locationType,
    "public");
  assert.equal(
    norm({country: "US", city: "Duluth", locationType: "private"})
      .locationType,
    "private");
});

test("rejects the stale server-only enum that caused the bug", () => {
  // These are the values the old inline narrowing accepted. Nothing in the
  // suite has ever produced them; if either is ever accepted again, every
  // wizard-created group silently loses its location once more.
  assert.equal(
    norm({country: "US", city: "Duluth", locationType: "public-place"}),
    undefined);
  assert.equal(
    norm({country: "US", city: "Duluth", locationType: "home"}), undefined);
  assert.equal(
    norm({country: "US", city: "Duluth", locationType: "anything"}),
    undefined);
  assert.equal(norm({country: "US", city: "Duluth"}), undefined);
});

test("drops the whole object when country or city is missing", () => {
  // Matches the previous behaviour: the caller then writes no location
  // field at all rather than a half-populated one.
  assert.equal(norm({city: "Duluth", locationType: "public"}), undefined);
  assert.equal(norm({country: "US", locationType: "public"}), undefined);
  assert.equal(
    norm({country: "  ", city: "Duluth", locationType: "public"}), undefined);
});

test("returns undefined for non-object input", () => {
  assert.equal(norm(undefined), undefined);
  assert.equal(norm(null), undefined);
  assert.equal(norm("Duluth, GA"), undefined);
});

test("a public venue's address is always visible", () => {
  // Forced true regardless of what the client sent - a public venue's
  // address is inherently fine to show, so there is no opt-in to respect.
  assert.equal(
    norm({country: "US", city: "Duluth", locationType: "public"})
      .addressVisible,
    true);
  assert.equal(
    norm({
      country: "US",
      city: "Duluth",
      locationType: "public",
      addressVisible: false,
    }).addressVisible,
    true);
});

test("a private location defaults to hidden and honours the opt-in", () => {
  const base = {country: "US", city: "Duluth", locationType: "private"};
  assert.equal(norm(base).addressVisible, false);
  assert.equal(norm({...base, addressVisible: false}).addressVisible, false);
  // Only a real boolean true opts in - a truthy string must not.
  assert.equal(norm({...base, addressVisible: "yes"}).addressVisible, false);
  assert.equal(norm({...base, addressVisible: true}).addressVisible, true);
});

test("optional state and address1 are omitted rather than undefined", () => {
  const bare = norm({country: "US", city: "Duluth", locationType: "public"});
  assert.equal("state" in bare, false);
  assert.equal("address1" in bare, false);

  const full = norm({
    country: "US",
    state: " GA ",
    city: "Duluth",
    locationType: "public",
    address1: "  1234 Main Street  ",
  });
  assert.equal(full.state, "GA");
  assert.equal(full.address1, "1234 Main Street");
});

test("coordinates are stored only when both are numbers", () => {
  const base = {country: "US", city: "Duluth", locationType: "public"};
  const both = norm({...base, lat: 34.0029, lng: -84.1446});
  assert.equal(both.lat, 34.0029);
  assert.equal(both.lng, -84.1446);

  for (const partial of [
    {lat: 34.0029},
    {lng: -84.1446},
    {lat: "34.0029", lng: "-84.1446"},
    {lat: 34.0029, lng: null},
  ]) {
    const result = norm({...base, ...partial});
    assert.equal("lat" in result, false);
    assert.equal("lng" in result, false);
  }
});

test("coordinates are kept for a hidden private address", () => {
  // Distance search must work even when the address is never displayed -
  // only display code checks addressVisible, never the distance math.
  const hidden = norm({
    country: "US",
    city: "Duluth",
    locationType: "private",
    address1: "1234 Main Street",
    addressVisible: false,
    lat: 34.0029,
    lng: -84.1446,
  });
  assert.equal(hidden.addressVisible, false);
  assert.equal(hidden.lat, 34.0029);
  assert.equal(hidden.lng, -84.1446);
});

test("long values are sliced to their per-field maximums", () => {
  const long = norm({
    country: "U".repeat(150),
    state: "S".repeat(150),
    city: "C".repeat(150),
    locationType: "public",
    address1: "A".repeat(250),
  });
  assert.equal(long.country.length, 100);
  assert.equal(long.state.length, 100);
  assert.equal(long.city.length, 100);
  assert.equal(long.address1.length, 200);
});
