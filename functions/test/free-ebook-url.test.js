// The free-ebook link in the newsletter confirmation, which moved off a
// hardcoded tokened Storage URL onto the `config` singleton on 2026-08-28.
//
// Why it moved: the URL carried a Storage download token, hardcoded here AND
// shipped in the Angular bundle via environment.freeEbookUrl. Rotating a
// leaked token therefore required a source edit plus a functions deploy,
// which is why it had not been done. On config it is a data edit.
//
// What these pin is the FAILURE SHAPE that change introduced. Reading from
// data means the value can now be absent, and the wrong answer to that is
// href="null" or href="undefined" in an email ~400 people a year receive.
// The offer is omitted instead, and the whole rest of the email still sends.
//
// queueSubscriptionConfirmation takes its Firestore handle as a parameter, so
// this needs no emulator and no Firebase app - just a fake db that returns a
// config snapshot.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {queueSubscriptionConfirmation} =
  require("../lib/transactional-emails");

const TO = "s@example.test";
const LIVE_URL =
  "https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8" +
  ".appspot.com/o/EBooks%2FM-7-Journal.pdf?alt=media&token=test-token";

// THROUGH THE SEAM, not a literal. This stub matched a bare "config" until
// 2026-09-02, and the day the production code started resolving that name
// through tenantPath() these four tests began failing silently - `npm test`
// is not part of `check-functions`, which runs lint and build only. Matching
// on the same function the code calls means the stub cannot drift from it
// again, whatever the path becomes.
const {tenantPath} = require("../lib/common/shared/lists/tenancy");

/**
 * A Firestore stand-in returning `configDocs` for the config collection and
 * capturing whatever gets added to collection("mail").
 * @param {Array<object>} configDocs Config documents to serve.
 * @return {object} The fake db plus the captured mail.
 */
function fakeDb(configDocs) {
  const queued = [];
  const db = {
    collection(name) {
      if (name === tenantPath("config")) {
        return {
          get: async () => ({
            empty: configDocs.length === 0,
            size: configDocs.length,
            docs: configDocs.map((data, i) => ({
              id: "cfg" + i,
              data: () => data,
            })),
          }),
        };
      }
      return {
        add: async (doc) => {
          queued.push(doc);
          return {id: "mail1"};
        },
        doc: () => ({set: async (doc) => {
          queued.push(doc);
        }}),
      };
    },
  };
  return {db, queued};
}

/** The html of the single queued mail. */
function sentHtml(queued) {
  assert.equal(queued.length, 1, "expected exactly one queued mail");
  const doc = queued[0];
  return doc.message?.html ?? doc.html ?? JSON.stringify(doc);
}

test("includes the ebook link when config carries freeEbookUrl", async () => {
  const {db, queued} = fakeDb([{freeEbookUrl: LIVE_URL}]);
  await queueSubscriptionConfirmation(db, "newsletter", "Sam", TO);
  const html = sentHtml(queued);
  assert.ok(html.includes(LIVE_URL), "the configured url should be linked");
  assert.ok(html.includes("free"), "the offer wording should be present");
});

test("OMITS the offer when freeEbookUrl is unset", async () => {
  const {db, queued} = fakeDb([{}]);
  await queueSubscriptionConfirmation(db, "newsletter", "Sam", TO);
  const html = sentHtml(queued);
  assert.equal(html.includes("null"), false, "must not emit href=\"null\"");
  assert.equal(html.includes("undefined"), false);
  assert.equal(html.includes("EBook"), false, "offer absent");
  // The rest of the email still has to go out.
  assert.ok(html.includes("Sam"), "greeting should survive");
  assert.ok(html.includes("Newletter"), "body should survive");
});

test("omits the offer when the value is not an https url", async () => {
  const {db, queued} = fakeDb([{freeEbookUrl: "javascript:alert(1)"}]);
  await queueSubscriptionConfirmation(db, "newsletter", "Sam", TO);
  const html = sentHtml(queued);
  assert.equal(html.includes("javascript:"), false);
  assert.equal(html.includes("EBook"), false);
});

test("omits the offer rather than guessing when config is not a singleton",
  async () => {
    // Same rule getPaypalClientId uses: two config docs means we cannot know
    // which is real, and picking one arbitrarily is how the wrong PayPal app
    // gets charged. Here the cost is only a missing offer, but the rule is
    // the same and it must not silently pick.
    const {db, queued} = fakeDb([
      {freeEbookUrl: LIVE_URL},
      {freeEbookUrl: "https://example.test/other.pdf"},
    ]);
    await queueSubscriptionConfirmation(db, "newsletter", "S", TO);
    const html = sentHtml(queued);
    assert.equal(html.includes("EBook"), false);
    assert.equal(html.includes("other.pdf"), false);
  });

test("the PRAYER confirmation never carried the offer and still does not",
  async () => {
    const {db, queued} = fakeDb([{freeEbookUrl: LIVE_URL}]);
    await queueSubscriptionConfirmation(db, "prayer", "Sam", TO);
    const html = sentHtml(queued);
    assert.equal(html.includes("EBook"), false);
    assert.ok(html.includes("Prayer"), "prayer wording should be present");
  });
