// The books collection-group helpers - one scan, four questions. Pinned
// against a fake Firestore so the six callers that used to write the scan
// themselves can rely on the same answers.
const {test} = require("node:test");
const assert = require("node:assert/strict");

const {
  allBookDocs, knownBookIds, findBookDoc, bookTitlesById,
} = require("../lib/utils/library-books");

const BOOKS = [
  ["b1", {title: "Impact One"}],
  ["b2", {title: "Impact Two"}],
  ["b3", {order: 3}], // no title - a half-authored book
];

let scans;
const fakeDb = () => ({
  collectionGroup: (name) => {
    assert.equal(name, "books");
    return {
      get: async () => {
        scans++;
        return {docs: BOOKS.map(([id, data]) => ({id, data: () => data}))};
      },
    };
  },
});

test("allBookDocs reads the books collection group once", async () => {
  scans = 0;
  const docs = await allBookDocs(fakeDb());
  assert.deepEqual(docs.map((d) => d.id), ["b1", "b2", "b3"]);
  assert.equal(scans, 1);
});

test("knownBookIds is the set of every book id", async () => {
  const ids = await knownBookIds(fakeDb());
  assert.equal(ids.has("b2"), true);
  assert.equal(ids.has("nope"), false);
  assert.equal(ids.size, 3);
});

test("findBookDoc finds by id and is undefined for a stranger", async () => {
  const doc = await findBookDoc(fakeDb(), "b2");
  assert.equal(doc.data().title, "Impact Two");
  assert.equal(await findBookDoc(fakeDb(), "nope"), undefined);
});

test("bookTitlesById skips a book with no title", async () => {
  const titles = await bookTitlesById(fakeDb());
  assert.deepEqual([...titles.entries()],
    [["b1", "Impact One"], ["b2", "Impact Two"]]);
});
