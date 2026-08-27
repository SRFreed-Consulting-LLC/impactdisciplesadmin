// Unit tests for renderEmailBody (utils/merge-tags.functions.ts) - the
// single-pass renderer that resolves BOTH email tag syntaxes.
//
// Why this suite matters: a transactional template that is editable in the
// email BUILDER can contain either syntax, because the builder's tag menu
// writes *|FNAME|* while every Quill-authored template in the live data uses
// {{firstName}}. Before this function, whichever renderer a send path used
// mailed the other syntax to the customer verbatim, and nothing errored
// anywhere - the failure is invisible until someone reads their inbox.
//
// The single-pass assertions are the security ones. renderPlaceholders' own
// comment records the bug that motivated them: a value substituted early
// being rescanned as if it were template.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {renderEmailBody} = require("../lib/utils/merge-tags.functions");

// ------------------------------------------------------------ builder tags

test("*|TAG|* resolves from the model", () => {
  assert.equal(
    renderEmailBody("<p>Hi *|FNAME|*,</p>", {firstName: "Alex"}),
    "<p>Hi Alex,</p>"
  );
});

test("an inline fallback is used only when the model has no value", () => {
  const tpl = "<p>*|TRACKING|No tracking yet.|*</p>";
  assert.equal(
    renderEmailBody(tpl, {tracking: "Tracking: 1Z999"}),
    "<p>Tracking: 1Z999</p>"
  );
  assert.equal(renderEmailBody(tpl, {}), "<p>No tracking yet.</p>");
});

test("a tag with no value and no fallback becomes its default", () => {
  // FNAME's defaultValue is the empty string; UNSUB's is "#".
  assert.equal(renderEmailBody("[*|FNAME|*]", {}), "[]");
  assert.equal(renderEmailBody("[*|UNSUB|*]", {}), "[#]");
});

test("an empty string in the model beats the fallback", () => {
  // `??`, not `||` - a deliberately blank value is a value.
  assert.equal(renderEmailBody("[*|FNAME|fallback|*]", {firstName: ""}), "[]");
});

// ------------------------------------------------------------ brace tokens

test("{{key}} resolves from the caller's arbitrary model", () => {
  // The event confirmation's keys - none of them are registered merge tags,
  // which is exactly why renderMergeTags alone could not serve that path.
  assert.equal(
    renderEmailBody(
      "<p>{{eventName}} on {{startDate}}. {{editRegistration}}</p>",
      {
        eventName: "Summit 2027",
        startDate: "March 3",
        editRegistration: "<a href='x'>Breakouts</a>",
      }
    ),
    "<p>Summit 2027 on March 3. <a href='x'>Breakouts</a></p>"
  );
});

test("legacy spellings registered on a tag still resolve", () => {
  assert.equal(
    renderEmailBody("<p>{{Recipient First Name}}</p>", {firstName: "Alex"}),
    "<p>Alex</p>"
  );
});

test("a legacy token survives Quill's &nbsp; between words", () => {
  // The live bug of 2026-08-24: Quill 2's getSemanticHTML() encodes every
  // space as &nbsp;, so an exact literal match missed the token entirely.
  assert.equal(
    renderEmailBody("{{Recipient&nbsp;First&nbsp;Name}}", {firstName: "Alex"}),
    "Alex"
  );
});

test("the caller's model wins over a legacy spelling of the same thing", () => {
  assert.equal(
    renderEmailBody("{{firstName}}", {firstName: "Alex"}), "Alex");
});

// ------------------------------------------------------- both, in one body

test("both syntaxes resolve in the same template", () => {
  assert.equal(
    renderEmailBody(
      "<p>Hi *|FNAME|* {{lastName}} - {{eventName}}</p>",
      {firstName: "Alex", lastName: "Rivera", eventName: "Summit"}
    ),
    "<p>Hi Alex Rivera - Summit</p>"
  );
});

// -------------------------------------------------------------- pass-through

test("unknown tags are left EXACTLY as written, in either syntax", () => {
  // Visible beats silent: a literal tag in an inbox gets reported, a quietly
  // deleted one does not.
  assert.equal(renderEmailBody("[*|NOPE|*]", {}), "[*|NOPE|*]");
  assert.equal(renderEmailBody("[{{nope}}]", {}), "[{{nope}}]");
  assert.equal(renderEmailBody("[{{phone.number}}]", {}), "[{{phone.number}}]");
});

test("an inherited property name does not interpolate", () => {
  assert.equal(
    renderEmailBody("[{{constructor}}]", {}), "[{{constructor}}]");
  assert.equal(
    renderEmailBody("[{{toString}}]", {}), "[{{toString}}]");
});

// ------------------------------------------------------------- SINGLE PASS

test("a substituted value is NEVER rescanned as template", () => {
  // The documented exploit: registering with a name that is itself a token.
  // firstName is escapeHtml'd upstream, but escapeHtml touches none of
  // { } | *, so the only thing standing between this and an expanded value
  // is that the scan reads the TEMPLATE once.
  assert.equal(
    renderEmailBody("<p>Hi {{firstName}}</p>", {
      firstName: "{{editRegistration}}",
      editRegistration: "<a href='secret'>link</a>",
    }),
    "<p>Hi {{editRegistration}}</p>"
  );

  assert.equal(
    renderEmailBody("<p>Hi *|FNAME|*</p>", {
      firstName: "*|UNSUB|*",
      unsubscribeUrl: "https://example.test/unsub?id=abc",
    }),
    "<p>Hi *|UNSUB|*</p>"
  );
});

test("a value that looks like a tag cannot leak a LATER tag's value", () => {
  // renderMergeTags' tag-by-tag loop fails this: FNAME is substituted first,
  // then the UNSUB pass rescans the result and expands what it planted.
  const out = renderEmailBody("*|FNAME|* / *|UNSUB|*", {
    firstName: "*|UNSUB|*",
    unsubscribeUrl: "https://example.test/u",
  });
  assert.equal(out, "*|UNSUB|* / https://example.test/u");
});

test("an empty body is handled", () => {
  assert.equal(renderEmailBody("", {}), "");
  assert.equal(renderEmailBody(undefined, {}), "");
});
