// Unit tests for deleteCampaign's pure helpers (campaign-admin.functions.ts)
// - the storage-URL extraction and the reference test that decide which
// images a campaign delete may remove. Runs against ../lib via `npm test`.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {collectStorageRefs, referencesPath} =
  require("../lib/campaign-admin.functions");

const URL1 = "https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8.appspot.com/o/" +
  "email-assets%2Fmailchimp%2Fabc123.png?alt=media&token=t-1";
const URL2 = "https://firebasestorage.googleapis.com/v0/b/impactdisciples-a82a8.appspot.com/o/" +
  "products%2Fhero%20image.jpg?alt=media&token=t-2";

test("collectStorageRefs: finds nested download URLs, decodes, dedupes", () => {
  const refs = new Map();
  collectStorageRefs({
    html: `<img src="${URL1}"><img src="${URL1}">`,
    design: {blocks: [{image: URL2}, {text: "no url here"}]},
    count: 3,
    nothing: null,
  }, refs);
  assert.equal(refs.size, 2);
  const paths = [...refs.values()].map((r) => r.objectPath).sort();
  assert.deepEqual(paths,
    ["email-assets/mailchimp/abc123.png", "products/hero image.jpg"]);
  assert.equal([...refs.values()][0].bucket,
    "impactdisciples-a82a8.appspot.com");
});

test("collectStorageRefs: ignores non-storage urls and mailchimp hosts", () => {
  const refs = new Map();
  collectStorageRefs({
    html: "<img src=\"https://mcusercontent.com/x/images/y.png\">" +
      "<a href=\"https://impactdisciples.com/store\">s</a>",
  }, refs);
  assert.equal(refs.size, 0);
});

test("referencesPath: matches the plain path or its encoded form", () => {
  const doc = JSON.stringify({html: `<img src="${URL2}">`});
  assert.equal(referencesPath(doc, "products/hero image.jpg"), true);
  assert.equal(referencesPath(doc, "products/other.jpg"), false);
  const raw = JSON.stringify({imagePath: "products/hero image.jpg"});
  assert.equal(referencesPath(raw, "products/hero image.jpg"), true);
});
