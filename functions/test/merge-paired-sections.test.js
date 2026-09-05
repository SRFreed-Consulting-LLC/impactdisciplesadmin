// THE MIGRATION THAT ALREADY CORRUPTED PRODUCTION ONCE.
//
// scripts/merge-paired-sections.js folds a `pairWithNext` pair into one
// two-column section. It ran against dev AND prod page data on 2026-09-05
// before it knew to rekey the incoming columns - so the Contact page ended up
// with two columns both called `col-1`. scripts/fix-duplicate-column-keys.js
// exists solely to repair that.
//
// WHY THAT BUG WAS INVISIBLE. Both templates that draw a section's columns
// track them BY KEY - `@for (column of columns; track column.key)` in the
// admin's section editor and in the web app's kit-section. Two columns
// sharing a key are ONE row as far as Angular is concerned: dragging one
// moves the other, deleting one deletes both, and the public page reuses the
// first column's DOM for the second. Nothing throws. Nothing logs.
//
// The script's own safety net (`if (next.some(b => 'pairWithNext' in b))`)
// catches the KEY surviving, which is not the failure that happened.
//
// It lives in functions/test because that is the repo's only node:test
// runner - the same reason functions/test/normalize-dates.test.js tests a
// scripts/ file. It reaches Firestore for nothing.

const test = require("node:test");
const assert = require("node:assert");

const {mergePairs, CONFLICTING} =
  require("../../scripts/merge-paired-sections");
const {rekey} = require("../../scripts/fix-duplicate-column-keys");

/**
 * A section as page_content stores one.
 * @param {string} key The section key.
 * @param {object} extra Anything to merge over the defaults.
 * @return {object} The block.
 */
function section(key, extra) {
  return {
    key,
    type: "section",
    variant: "columns",
    isActive: true,
    columns: [{key: "col-1", pieces: [{key: "heading-1", kind: "heading"}]}],
    ...extra,
  };
}

/** @param {Array} blocks The page. @return {Array} The merged page. */
function merge(blocks) {
  return mergePairs(blocks, "test-page").blocks;
}

test("a merged section's columns do not share a key", () => {
  // THE BUG. Each half numbered its own columns from col-1, so a straight
  // concatenation produced two col-1s and Angular drew them as one column.
  const out = merge([
    section("intro", {pairWithNext: true}),
    section("form"),
  ]);

  assert.equal(out.length, 1, "the pair should become one section");
  const keys = out[0].columns.map((c) => c.key);
  assert.equal(keys.length, 2);
  assert.equal(new Set(keys).size, 2, `columns share a key: ${keys}`);
});

test("the merged section keeps both halves' columns, in order, intact", () => {
  // Per-column settings live on the column and must travel untouched - the
  // Contact page's left `inset` and its right `align`/`measure`.
  const left = section("intro", {
    pairWithNext: true,
    columns: [{key: "col-1", inset: true, pieces: [{key: "a", kind: "text"}]}],
  });
  const right = section("form", {
    columns: [{
      key: "col-1", align: "centre", measure: true,
      pieces: [{key: "b", kind: "form", formId: "f1"}],
    }],
  });

  const out = merge([left, right]);
  const [first, second] = out[0].columns;

  assert.equal(first.inset, true);
  assert.equal(second.align, "centre");
  assert.equal(second.measure, true);
  assert.equal(first.pieces[0].kind, "text");
  assert.equal(second.pieces[0].formId, "f1");
});

test("piece keys may repeat across columns and are left alone", () => {
  // Pieces are tracked WITHIN their own column (`piecesOf(column)` /
  // `livePieces(column)`), so the same piece key in two different columns
  // collides with nothing. Renaming them would be churn on live data.
  const out = merge([
    section("intro", {pairWithNext: true}),
    section("form"),
  ]);

  const pieceKeys = out[0].columns.map((c) => c.pieces[0].key);
  assert.deepEqual(pieceKeys, ["heading-1", "heading-1"]);
});

test("no output block carries pairWithNext", () => {
  // The lever is gone from the editor; a document that still sets it would
  // split back into two stacked bands on the live site.
  const out = merge([
    section("intro", {pairWithNext: true}),
    section("form"),
    section("tail", {pairWithNext: true}),
  ]);

  assert.ok(!JSON.stringify(out).includes("pairWithNext"));
});

test("a section pairing with nothing loses the key, keeps its content", () => {
  // The site already stacked it quietly. Dropping the key must not drop the
  // section - these documents are the only copy of a page's words.
  const out = merge([section("last", {pairWithNext: true})]);

  assert.equal(out.length, 1);
  assert.equal(out[0].key, "last");
  assert.ok(!("pairWithNext" in out[0]));
  assert.equal(out[0].columns.length, 1);
});

test("a pair whose halves disagree about the look is REFUSED", () => {
  // One section cannot have two grounds. Silently keeping the first would
  // change a page without saying so, so both blocks survive untouched and the
  // note tells a human to do it by hand.
  for (const field of CONFLICTING) {
    const out = mergePairs([
      section("a", {pairWithNext: true, [field]: "one"}),
      section("b", {[field]: "two"}),
    ], "test-page");

    assert.equal(out.blocks.length, 2,
      `${field} should refuse to merge`);
    assert.ok(
      out.notes.some((n) => n.includes("REFUSED") && n.includes(field)),
      `${field} should be named in the refusal`
    );
    // ...and the key is NOT dropped, so main()'s own guard stops the write.
    assert.ok(JSON.stringify(out.blocks).includes("pairWithNext"));
  }
});

test("an unpaired page is returned unchanged", () => {
  const page = [section("hero"), section("body"), section("closing")];
  assert.deepEqual(merge(page), page);
});

test("the merger and the repair script agree", () => {
  // Two hand-written copies of one rekeying rule, and one of them has already
  // corrupted production. This is the tenancy-mirror pattern applied to the
  // thing that actually broke: if mergePairs starts producing collisions
  // again, running the repair over its output changes something - and that
  // difference is the alarm.
  const out = merge([
    section("intro", {pairWithNext: true}),
    section("form"),
  ]);
  const before = JSON.stringify(out);

  out.forEach((block) => {
    if (Array.isArray(block.columns)) {
      rekey(block.columns, () => undefined);
    }
  });

  assert.equal(JSON.stringify(out), before,
    "the repair found something the merger should not have produced");
});

test("the repair is idempotent", () => {
  // Its header promises "safe to run again on anything". A repair that
  // renames on every run turns a fix into drift, and each run writes to prod.
  const columns = [{key: "col-1"}, {key: "col-1"}, {key: "col-1"}];

  const firstPass = rekey(columns, () => undefined);
  assert.equal(firstPass, true);
  assert.deepEqual(columns.map((c) => c.key), ["col-1", "col-1-2", "col-1-3"]);

  const secondPass = rekey(columns, () => undefined);
  assert.equal(secondPass, false, "a second run should rename nothing");
  assert.deepEqual(columns.map((c) => c.key), ["col-1", "col-1-2", "col-1-3"]);
});
