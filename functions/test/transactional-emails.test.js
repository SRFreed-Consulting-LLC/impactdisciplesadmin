// Unit tests for the two shared mail helpers in transactional-emails.ts:
// htmlToPlainText (the plain-text alternative part of every queued email)
// and renderPlaceholders (the {{key}} substitution three call sites used to
// each implement inline). Runs against ../lib via `npm test`; no emulator
// and no Firebase app - queueMail takes its Firestore handle as a parameter
// precisely so this module is requireable on its own.
//
// Why this suite matters: the <style>-stripping assertions below pin a real
// bug found during the 2026-08-21 consolidation. htmlToPlainText stripped
// TAGS but not the CSS *text* inside <style>, so every templated email
// queued through queueMail shipped a plain-text part that opened with a
// wall of raw CSS. Anyone "simplifying" the two element-stripping regexes
// back out will fail these.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {htmlToPlainText, renderPlaceholders} =
  require("../lib/transactional-emails");

test("htmlToPlainText drops <style> CONTENTS, not just its tags", () => {
  const html =
    "<html><head><style>.a{color:red;font-family:Arial}</style></head>" +
    "<body><p>Hi Sam</p></body></html>";
  const text = htmlToPlainText(html);
  assert.equal(text.includes("color:red"), false);
  assert.equal(text.includes("font-family"), false);
  assert.equal(text, "Hi Sam");
});

test("htmlToPlainText drops <script> element contents too", () => {
  const html = "<div><script>var x = 1;</script><p>Hello</p></div>";
  const text = htmlToPlainText(html);
  assert.equal(text.includes("var x"), false);
  assert.equal(text, "Hello");
});

test("htmlToPlainText handles a multi-line/attributed style block", () => {
  const html =
    "<style type=\"text/css\" media=\"all\">\n" +
    "  body { margin: 0 }\n  .btn { padding: 4px }\n" +
    "</style><p>Body copy</p>";
  assert.equal(htmlToPlainText(html), "Body copy");
});

test("htmlToPlainText turns <br> and block ends into newlines", () => {
  assert.equal(htmlToPlainText("<p>One</p><p>Two</p>"), "One\nTwo");
  assert.equal(htmlToPlainText("Line one<br/>Line two"), "Line one\nLine two");
});

test("htmlToPlainText decodes the entities templates actually emit", () => {
  const text = htmlToPlainText(
    "<p>Tom &amp; Jerry &lt;tag&gt; &quot;quoted&quot; it&#39;s&nbsp;fine</p>"
  );
  assert.equal(text, "Tom & Jerry <tag> \"quoted\" it's fine");
});

test("htmlToPlainText collapses runs of blank lines and trims", () => {
  assert.equal(htmlToPlainText("<p>A</p><br><br><br><p>B</p>"), "A\n\nB");
});

test("htmlToPlainText on empty/plain input is a no-op", () => {
  assert.equal(htmlToPlainText(""), "");
  assert.equal(htmlToPlainText("already plain"), "already plain");
});

test("renderPlaceholders substitutes every occurrence of each key", () => {
  const out = renderPlaceholders(
    "<p>Hi {{firstName}}, bye {{firstName}}</p>",
    {firstName: "Sam"}
  );
  assert.equal(out, "<p>Hi Sam, bye Sam</p>");
});

test("renderPlaceholders leaves unknown placeholders untouched", () => {
  // Staff author these templates by hand; a typo'd tag must survive as
  // literal text rather than silently becoming an empty string.
  const out = renderPlaceholders("{{firstName}} {{nope}}", {firstName: "Sam"});
  assert.equal(out, "Sam {{nope}}");
});

test("renderPlaceholders substitutes values verbatim (no re-escaping)", () => {
  // Call sites escape user input BEFORE building the model; double-escaping
  // here would render "&amp;lt;" in the email body.
  const out = renderPlaceholders("<p>{{link}}</p>", {
    link: "<a href='https://x.test'>Go</a>",
  });
  assert.equal(out, "<p><a href='https://x.test'>Go</a></p>");
});

test("renderPlaceholders does not re-substitute an injected tag", () => {
  // Regression pin. The three inline loops this helper replaced substituted
  // one key at a time, so a value substituted early was rescanned by every
  // later iteration: registering as "{{editRegistration}}" (braces survive
  // escapeHtml) expanded that model value into the name position. The
  // single-pass renderer must emit the injected text literally.
  const out = renderPlaceholders("<p>Hi {{firstName}}</p>", {
    firstName: "{{editRegistration}}",
    editRegistration: "<a href='https://evil.test'>Register</a>",
  });
  assert.equal(out, "<p>Hi {{editRegistration}}</p>");
});

test("renderPlaceholders ignores inherited Object.prototype names", () => {
  assert.equal(
    renderPlaceholders("{{constructor}}|{{toString}}", {firstName: "Sam"}),
    "{{constructor}}|{{toString}}"
  );
});

test("renderPlaceholders substitutes underscored keys (product_list)", () => {
  const out = renderPlaceholders("<td>{{product_list}}</td>", {
    product_list: "<li>Book</li>",
  });
  assert.equal(out, "<td><li>Book</li></td>");
});

test("renderPlaceholders with an empty model returns body unchanged", () => {
  assert.equal(renderPlaceholders("<p>{{x}}</p>", {}), "<p>{{x}}</p>");
});

test("renderPlaceholders handles an empty body", () => {
  assert.equal(renderPlaceholders("", {firstName: "Sam"}), "");
});
