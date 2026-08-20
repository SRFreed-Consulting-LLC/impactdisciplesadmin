// Unit tests for the public newsletter archive's pure helpers
// (newsletter-archive.functions.ts). Like merge-tags.test.js these run
// against the COMPILED output (../lib) via `npm test` - plain node:test, no
// emulator, no Firebase app (the module's onRequest export is created at
// import time but never invoked here).
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {prepareArchiveHtml, archiveTitle, isPublishedTouch} =
  require("../lib/newsletter-archive.functions");

test("isPublishedTouch: flagged AND sent/sending only", () => {
  assert.equal(isPublishedTouch({publishToWeb: true, status: "sent"}), true);
  assert.equal(isPublishedTouch({publishToWeb: true, status: "sending"}), true);
  assert.equal(isPublishedTouch({publishToWeb: true, status: "draft"}), false);
  assert.equal(isPublishedTouch({publishToWeb: false, status: "sent"}), false);
  assert.equal(isPublishedTouch({status: "sent"}), false);
  assert.equal(isPublishedTouch(undefined), false);
});

test("archiveTitle: webTitle, then label, then subject, then fallback", () => {
  assert.equal(archiveTitle({webTitle: " Oct 2025 ", label: "L", subject: "S"}), "Oct 2025");
  assert.equal(archiveTitle({webTitle: "", label: "L", subject: "S"}), "L");
  assert.equal(archiveTitle({label: null, subject: "S"}), "S");
  assert.equal(archiveTitle({}), "Newsletter");
});

test("prepareArchiveHtml: renders our tags anonymously and strips Mailchimp-only tags", () => {
  const raw = "<!DOCTYPE html><html><head><title>*|MC:SUBJECT|*</title></head>" +
    "<body>*|IF:MC_PREVIEW_TEXT|*<span>*|MC_PREVIEW_TEXT|*</span>*|END:IF|*" +
    "Hi *|FNAME|*, see <a href=\"*|ARCHIVE|*\">the archive</a> or " +
    "<a href=\"*|UNSUB|*\">unsubscribe</a></body></html>";
  const out = prepareArchiveHtml(raw, "Impact <October> 2025");
  assert.ok(out.includes("<title>Impact &lt;October&gt; 2025</title>"));
  assert.ok(!out.includes("*|"), "no *|TAG|* survives: " + out);
  assert.ok(out.includes("Hi , see"));
  assert.ok(out.includes("href=\"#\">unsubscribe"));
  // Full documents pass through unwrapped.
  assert.ok(out.startsWith("<!DOCTYPE html>"));
  assert.equal((out.match(/<html/gi) || []).length, 1);
});

test("prepareArchiveHtml: wraps a bare fragment into a document", () => {
  const out = prepareArchiveHtml("<p>Hello {{Recipient First Name}}</p>", "Issue");
  assert.ok(out.startsWith("<!DOCTYPE html><html>"));
  assert.ok(out.includes("<title>Issue</title>"));
  assert.ok(out.includes("<div class=\"newsletter\"><p>Hello </p></div>"));
});

test("prepareArchiveHtml: drops scripts and inline handlers", () => {
  const out = prepareArchiveHtml(
    "<html><body><script>alert(1)</script><img src=\"x\" onerror=\"alert(2)\">" +
    "<a href=\"https://x.test/?option=1\" onclick='go()'>ok</a></body></html>", "T");
  assert.ok(!/<script/i.test(out));
  assert.ok(!/onerror|onclick/i.test(out));
  // Attribute VALUES containing "on...=" are untouched.
  assert.ok(out.includes("href=\"https://x.test/?option=1\""));
});
