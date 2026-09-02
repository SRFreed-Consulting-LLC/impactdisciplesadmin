"use strict";
// Covers the two PURE stages of the lesson PDF: parsing a lesson's stored HTML
// into printable blocks, and projecting a Form.io schema plus one reader's
// saved answers into the document model. The pdfkit layout stage is not
// asserted here - what it produces is a binary the eye judges, and the parts
// that can silently go wrong (a dropped answer, a question that stops being a
// question) all live upstream of it.
const test = require("node:test");
const assert = require("node:assert");

const {htmlToBlocks, decodeEntities} = require("../lib/lesson-pdf/html-text");
const {buildLessonDoc, stripTags, scalarText} =
  require("../lib/lesson-pdf/lesson-doc");

const text = (block) => block.runs.map((r) => r.text).join("");

test("htmlToBlocks: paragraphs become separate blocks", () => {
  const blocks = htmlToBlocks("<p>First one.</p><p>Second one.</p>");
  assert.strictEqual(blocks.length, 2);
  assert.strictEqual(text(blocks[0]).trim(), "First one.");
  assert.strictEqual(text(blocks[1]).trim(), "Second one.");
});

test("htmlToBlocks: bold and italic survive as run styles", () => {
  const blocks =
    htmlToBlocks("<p>a <strong>bold</strong> <em>slanted</em></p>");
  const bold = blocks[0].runs.find((r) => r.text.includes("bold"));
  const italic = blocks[0].runs.find((r) => r.text.includes("slanted"));
  assert.ok(bold.bold, "strong should mark its run bold");
  assert.ok(italic.italic, "em should mark its run italic");
});

test("htmlToBlocks: headings are capped at three levels", () => {
  // The lessons only use three visual levels; inventing six would not read as
  // a hierarchy on paper.
  assert.strictEqual(htmlToBlocks("<h1>A</h1>")[0].heading, 1);
  assert.strictEqual(htmlToBlocks("<h5>A</h5>")[0].heading, 3);
});

test("htmlToBlocks: list items are numbered only when ordered", () => {
  const bulleted = htmlToBlocks("<ul><li>one</li><li>two</li></ul>");
  assert.deepStrictEqual(bulleted.map((b) => b.kind),
    ["listItem", "listItem"]);
  assert.strictEqual(bulleted[0].ordinal, undefined);

  const numbered = htmlToBlocks("<ol><li>one</li><li>two</li></ol>");
  assert.strictEqual(numbered[0].ordinal, 1);
  assert.strictEqual(numbered[1].ordinal, 2);
});

test("htmlToBlocks: keeps embedded images, drops remote ones", () => {
  // A remote src would mean a network fetch per image while a reader waits,
  // and lesson art is inlined before this ever runs.
  const embedded = htmlToBlocks("<img src=\"data:image/png;base64,AAAA\">");
  assert.strictEqual(embedded.length, 1);
  assert.strictEqual(embedded[0].kind, "image");
  assert.strictEqual(htmlToBlocks("<img src=\"https://x/y.png\">").length, 0);
});

test("decodeEntities: handles named, decimal and hex forms", () => {
  assert.strictEqual(decodeEntities("Jesus&rsquo; life"), "Jesus’ life");
  assert.strictEqual(decodeEntities("a &amp; b"), "a & b");
  assert.strictEqual(decodeEntities("&#65;&#x42;"), "AB");
});

test("decodeEntities: leaves an unknown entity alone", () => {
  // Inherited property names must not resolve off Object.prototype.
  assert.strictEqual(decodeEntities("&constructor;"), "&constructor;");
  assert.strictEqual(decodeEntities("&nope;"), "&nope;");
});

test("scalarText: renders each stored value shape", () => {
  assert.strictEqual(scalarText(undefined), "");
  assert.strictEqual(scalarText(""), "");
  assert.strictEqual(scalarText(true), "Yes");
  assert.strictEqual(scalarText(false), "No");
  assert.strictEqual(scalarText(["a", "b"]), "a, b");
  assert.strictEqual(scalarText({a: true, b: false}), "a");
});

test("stripTags: reduces marked-up labels to plain text", () => {
  assert.strictEqual(stripTags("<p>What does <b>John 3:3</b> say?</p>"),
    "What does John 3:3 say?");
});

test("buildLessonDoc: an answered question carries the reader's words", () => {
  const schema = {components: [
    {type: "textarea", key: "q1", label: "What did Jesus say?"},
  ]};
  const [question] = buildLessonDoc(schema, {q1: "You must be born again."});
  assert.strictEqual(question.kind, "question");
  assert.strictEqual(question.label, "What did Jesus say?");
  assert.deepStrictEqual(question.answer,
    {kind: "text", value: "You must be born again.", lines: 0});
});

test("buildLessonDoc: an unanswered textarea asks for writing room", () => {
  // The whole point of the feature working on an unfinished lesson.
  const schema = {components: [
    {type: "textarea", key: "q1", label: "Your thoughts", rows: 5},
  ]};
  const [question] = buildLessonDoc(schema, {});
  assert.strictEqual(question.answer.value, "");
  assert.strictEqual(question.answer.lines, 5);
});

test("buildLessonDoc: a short unanswered field gets one line", () => {
  const schema = {components: [{type: "textfield", key: "q", label: "Name"}]};
  assert.strictEqual(buildLessonDoc(schema, {})[0].answer.lines, 1);
});

test("buildLessonDoc: radio marks the chosen option", () => {
  const schema = {components: [{
    type: "radio", key: "pick", label: "Pick one",
    values: [{label: "Yes", value: "y"}, {label: "No", value: "n"}],
  }]};
  const [question] = buildLessonDoc(schema, {pick: "n"});
  assert.deepStrictEqual(question.answer.options, [
    {label: "Yes", chosen: false},
    {label: "No", chosen: true},
  ]);
});

test("buildLessonDoc: selectboxes reads its per-option map", () => {
  // radio/select store a scalar; selectboxes stores {optionValue: boolean}.
  const schema = {components: [{
    type: "selectboxes", key: "many", label: "All that apply",
    values: [{label: "A", value: "a"}, {label: "B", value: "b"}],
  }]};
  const [question] = buildLessonDoc(schema, {many: {a: true, b: false}});
  assert.deepStrictEqual(question.answer.options.map((o) => o.chosen),
    [true, false]);
});

test("buildLessonDoc: select reads options from data.values", () => {
  const schema = {components: [{
    type: "select", key: "s", label: "Choose",
    data: {values: [{label: "One", value: "1"}]},
  }]};
  const [question] = buildLessonDoc(schema, {s: "1"});
  assert.deepStrictEqual(question.answer.options, [
    {label: "One", chosen: true},
  ]);
});

test("buildLessonDoc: an empty grid still prints rows to write in", () => {
  const schema = {components: [{
    type: "datagrid", key: "g", label: "Notes",
    components: [{type: "textfield", key: "c", label: "Cell"}],
  }]};
  const [question] = buildLessonDoc(schema, {});
  assert.deepStrictEqual(question.answer.headers, ["Cell"]);
  assert.strictEqual(question.answer.rows.length, 3);
});

test("buildLessonDoc: a filled grid prints what was entered", () => {
  const schema = {components: [{
    type: "datagrid", key: "g", label: "Notes",
    components: [{type: "textfield", key: "c", label: "Cell"}],
  }]};
  const [question] = buildLessonDoc(schema, {g: [{c: "written"}]});
  assert.deepStrictEqual(question.answer.rows, [["written"]]);
});

test("buildLessonDoc: tabs become titled sections, not tabs", () => {
  const schema = {components: [{type: "tabs", components: [
    {label: "Read", components: [{type: "content", html: "<p>text</p>"}]},
    {label: "Reflect", components: [
      {type: "textfield", key: "r", label: "Why?"},
    ]},
  ]}]};
  const nodes = buildLessonDoc(schema, {});
  const titles = nodes.filter((n) => n.kind === "sectionTitle")
    .map((n) => n.text);
  assert.deepStrictEqual(titles, ["Read", "Reflect"]);
  assert.ok(nodes.some((n) => n.kind === "question" && n.label === "Why?"));
});

test("buildLessonDoc: buttons and hidden fields never print", () => {
  // A Save button means nothing on paper, and a hidden field is a stored value
  // the reader has never seen.
  const schema = {components: [
    {type: "button", key: "submit", label: "Save"},
    {type: "hidden", key: "stamp"},
  ]};
  assert.deepStrictEqual(buildLessonDoc(schema, {stamp: "v1"}), []);
});

test("buildLessonDoc: survey rows report the chosen column", () => {
  const schema = {components: [{
    type: "survey", key: "s", label: "Rate these",
    values: [{label: "Agree", value: "a"}, {label: "Disagree", value: "d"}],
    questions: [{label: "Statement one", value: "q1"}],
  }]};
  const [question] = buildLessonDoc(schema, {s: {q1: "d"}});
  assert.deepStrictEqual(question.answer.columns, ["Agree", "Disagree"]);
  assert.deepStrictEqual(question.answer.rows,
    [{label: "Statement one", chosen: "Disagree"}]);
});

test("buildLessonDoc: signature reports only whether it was signed", () => {
  const schema = {components: [
    {type: "signature", key: "sig", label: "Sign here"},
  ]};
  assert.deepStrictEqual(
    buildLessonDoc(schema, {sig: "data:image/png;base64,AAA"})[0].answer,
    {kind: "signed", signed: true});
  assert.deepStrictEqual(buildLessonDoc(schema, {})[0].answer,
    {kind: "signed", signed: false});
});

test("buildLessonDoc: survives a null schema", () => {
  assert.deepStrictEqual(buildLessonDoc(null, {}), []);
  assert.deepStrictEqual(buildLessonDoc(undefined, {}), []);
});
