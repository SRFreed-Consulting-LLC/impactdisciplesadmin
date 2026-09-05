// The per-recipient unsubscribe token. Pinned: it binds address AND list,
// ignores the address's case, cannot be verified under another secret or
// with a mangled token, and the legacy grace period ends on the stated day.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {
  unsubscribeToken, verifyUnsubscribeToken, legacyLinksStillHonoured,
  LEGACY_UNSUBSCRIBE_LINKS_UNTIL,
} = require("../lib/utils/unsubscribe-token");

const SECRET = "test-secret";

test("is 32 hex characters and stable", () => {
  const t = unsubscribeToken("a@x.test", "newsletter", SECRET);
  assert.match(t, /^[0-9a-f]{32}$/);
  assert.equal(t, unsubscribeToken("a@x.test", "newsletter", SECRET));
});

test("ignores the address's case and padding - links are copied around", () => {
  assert.equal(unsubscribeToken(" A@X.TEST ", "newsletter", SECRET),
    unsubscribeToken("a@x.test", "newsletter", SECRET));
});

test("differs per list and per address", () => {
  const a = unsubscribeToken("a@x.test", "newsletter", SECRET);
  assert.notEqual(a, unsubscribeToken("a@x.test", "prayer", SECRET));
  assert.notEqual(a, unsubscribeToken("b@x.test", "newsletter", SECRET));
});

test("verifies its own token and nothing else", () => {
  const t = unsubscribeToken("a@x.test", "newsletter", SECRET);
  assert.equal(verifyUnsubscribeToken("A@x.test", "newsletter", t, SECRET),
    true);
  assert.equal(verifyUnsubscribeToken("a@x.test", "prayer", t, SECRET),
    false);
  assert.equal(verifyUnsubscribeToken("a@x.test", "newsletter", t, "other"),
    false);
  assert.equal(verifyUnsubscribeToken("a@x.test", "newsletter",
    t.slice(0, 31) + "0", SECRET), false);
  assert.equal(verifyUnsubscribeToken("a@x.test", "newsletter", "", SECRET),
    false);
  assert.equal(verifyUnsubscribeToken("a@x.test", "newsletter", 42, SECRET),
    false);
  // Same length, not hex - must not reach timingSafeEqual with a longer
  // byte string.
  assert.equal(verifyUnsubscribeToken("a@x.test", "newsletter",
    "é".repeat(32), SECRET), false);
});

test("untokened links are honoured until the cutover day, not after", () => {
  assert.equal(LEGACY_UNSUBSCRIBE_LINKS_UNTIL, Date.UTC(2026, 9, 6));
  assert.equal(legacyLinksStillHonoured(LEGACY_UNSUBSCRIBE_LINKS_UNTIL - 1),
    true);
  assert.equal(legacyLinksStillHonoured(LEGACY_UNSUBSCRIBE_LINKS_UNTIL),
    false);
});
