// Unit tests for the functions-side merge-tag engine (the manual mirror of
// src/app/common/utils/email/merge-tags.ts - that twin has its own Karma
// spec; keep the two suites aligned when either engine changes).
//
// These run against the COMPILED output (../lib) via `npm test`, which
// builds first - plain node:test, no emulator, no Firebase app.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {renderMergeTags, MERGE_TAGS} =
  require("../lib/utils/merge-tags.functions");

test("replaces a plain tag with the context value", () => {
  assert.equal(
    renderMergeTags("Hi *|FNAME|*!", {firstName: "Ada"}),
    "Hi Ada!"
  );
});

test("replaces EVERY occurrence, not just the first", () => {
  assert.equal(
    renderMergeTags("*|FNAME|* and *|FNAME|*", {firstName: "Ada"}),
    "Ada and Ada"
  );
});

test("missing value falls back to the tag's defaultValue", () => {
  assert.equal(renderMergeTags("Hi *|FNAME|*!", {}), "Hi !");
  // UNSUB's registered default is "#", not "".
  assert.equal(renderMergeTags("<a href=\"*|UNSUB|*\">u</a>", {}),
    "<a href=\"#\">u</a>");
});

test("inline fallback form *|TAG|fallback|* wins over defaultValue", () => {
  assert.equal(renderMergeTags("Hi *|FNAME|friend|*!", {}), "Hi friend!");
});

test("inline fallback is ignored when a real value exists", () => {
  assert.equal(
    renderMergeTags("Hi *|FNAME|friend|*!", {firstName: "Ada"}),
    "Hi Ada!"
  );
});

test("legacy {{...}} spellings are absorbed by the same tag", () => {
  assert.equal(
    renderMergeTags("Hi {{Recipient First Name}} ({{firstName}})",
      {firstName: "Ada"}),
    "Hi Ada (Ada)"
  );
});

test("unknown tags pass through untouched", () => {
  assert.equal(renderMergeTags("*|NOPE|*", {}), "*|NOPE|*");
});

test("UNSUB resolves the caller-supplied unsubscribe URL", () => {
  assert.equal(
    renderMergeTags("*|UNSUB|*", {unsubscribeUrl: "https://x.test/u?e=a"}),
    "https://x.test/u?e=a"
  );
});

test("null/undefined html renders as empty string", () => {
  assert.equal(renderMergeTags(null, {}), "");
  assert.equal(renderMergeTags(undefined, {}), "");
});

test("every registered tag has a tag and resolverKey", () => {
  for (const def of MERGE_TAGS) {
    assert.ok(def.tag.length > 0);
    assert.ok(def.resolverKey.length > 0);
  }
});
