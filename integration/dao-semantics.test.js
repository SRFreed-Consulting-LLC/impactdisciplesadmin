// Pins the CLIENT-SDK Firestore contracts FirebaseDAO builds on - the
// semantics the app's correctness quietly depends on, exercised against
// the real emulator so an SDK upgrade that changes any of them fails loud:
//
//  - updateDoc (DAO.updateFields) is a PARTIAL update: untouched fields
//    survive byte-for-byte (the lastNameLower guarantee - the reason
//    updateFields exists at all, vs update()'s whole-doc setDoc-no-merge).
//  - arrayUnion is idempotent, arrayRemove removes all occurrences
//    (assignTrainingSession / removeTrainingSession).
//  - orderBy() EXCLUDES docs missing the field entirely (the documented
//    pagination gotcha - see CLAUDE.md's Pagination section).
//  - startAfter-cursor pagination walks without overlap or gaps (getPage).
//
// Uses @firebase/rules-unit-testing purely as client-SDK plumbing, under
// its own project id (demo-dao) with rules bypassed - this suite is about
// data semantics, not security.
const {test, before, after} = require("node:test");
const assert = require("node:assert/strict");
const {initializeTestEnvironment} = require("@firebase/rules-unit-testing");
const {
  doc, getDoc, setDoc, updateDoc, collection, getDocs,
  query, orderBy, limit, startAfter, arrayUnion, arrayRemove,
} = require("firebase/firestore");

let env;
let db;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-dao",
    firestore: {
      rules: "rules_version = '2';\n" +
        "service cloud.firestore { match /databases/{d}/documents {" +
        " match /{document=**} { allow read, write: if true; } } }",
      host: "localhost",
      port: 8080,
    },
  });
  db = env.unauthenticatedContext().firestore();
});

after(async () => {
  await env.cleanup();
});

test("updateDoc is partial: untouched fields survive (updateFields contract)", async () => {
  const ref = doc(db, "regs/r1");
  await setDoc(ref, {
    firstName: "Ada", lastName: "Zulu", lastNameLower: "zulu",
    email: "ada@x.test", trainingSessions: ["s1"],
  });
  await updateDoc(ref, {firstName: "Adaline"});
  const data = (await getDoc(ref)).data();
  assert.equal(data.firstName, "Adaline");
  assert.equal(data.lastNameLower, "zulu"); // preserved - THE guarantee
  assert.deepEqual(data.trainingSessions, ["s1"]);
  assert.equal(Object.keys(data).length, 5); // nothing dropped, nothing added
});

test("setDoc (DAO.update) is whole-doc: omitted fields are DELETED", async () => {
  const ref = doc(db, "regs/r2");
  await setDoc(ref, {firstName: "Bo", lastNameLower: "bo", extra: 1});
  await setDoc(ref, {firstName: "Bo"}); // no merge - the round-trip hazard
  const data = (await getDoc(ref)).data();
  assert.deepEqual(Object.keys(data), ["firstName"]);
});

test("arrayUnion idempotent; arrayRemove removes every occurrence", async () => {
  const ref = doc(db, "regs/r3");
  await setDoc(ref, {trainingSessions: []});
  await updateDoc(ref, {trainingSessions: arrayUnion("s1")});
  await updateDoc(ref, {trainingSessions: arrayUnion("s1")});
  await updateDoc(ref, {trainingSessions: arrayUnion("s2")});
  assert.deepEqual((await getDoc(ref)).data().trainingSessions, ["s1", "s2"]);
  await updateDoc(ref, {trainingSessions: arrayRemove("s1")});
  assert.deepEqual((await getDoc(ref)).data().trainingSessions, ["s2"]);
});

test("orderBy EXCLUDES docs missing the field (the pagination gotcha)", async () => {
  await setDoc(doc(db, "people/p1"), {name: "One", sortKey: "a"});
  await setDoc(doc(db, "people/p2"), {name: "Two"}); // no sortKey
  await setDoc(doc(db, "people/p3"), {name: "Three", sortKey: "c"});
  const snap = await getDocs(query(collection(db, "people"), orderBy("sortKey")));
  assert.deepEqual(snap.docs.map((d) => d.id), ["p1", "p3"]); // p2 GONE
});

test("startAfter cursor pagination: no overlap, no gaps, hasMore edge", async () => {
  for (let i = 1; i <= 7; i++) {
    await setDoc(doc(db, `pages/x${i}`), {n: i});
  }
  const first = await getDocs(query(collection(db, "pages"), orderBy("n"), limit(3)));
  assert.deepEqual(first.docs.map((d) => d.data().n), [1, 2, 3]);
  const second = await getDocs(query(collection(db, "pages"), orderBy("n"),
    startAfter(first.docs[first.docs.length - 1]), limit(3)));
  assert.deepEqual(second.docs.map((d) => d.data().n), [4, 5, 6]);
  const third = await getDocs(query(collection(db, "pages"), orderBy("n"),
    startAfter(second.docs[second.docs.length - 1]), limit(3)));
  assert.deepEqual(third.docs.map((d) => d.data().n), [7]); // short = last page
});

test("explicit undefined is REJECTED whole-write (the CLAUDE.md gotcha)", async () => {
  // async wrapper: the client SDK throws this one SYNCHRONOUSLY (local
  // validation before any network) - itself part of the pinned behavior.
  await assert.rejects(
    async () => setDoc(doc(db, "regs/r4"), {ok: "fine", nested: {by: undefined}}),
    /Unsupported field value/i
  );
  // The doc must not exist at all - the write failed atomically.
  assert.equal((await getDoc(doc(db, "regs/r4"))).exists(), false);
});
