// Integration: emailLessonPdf and createGroup's permission gates, driven
// through the REAL callables in the emulator over the onCall protocol, with a
// real signed-in ID token.
//
// The pure pieces of both (library-access.ts, lesson-doc.ts, html-text.ts,
// limits.ts) have unit tests. What only this level can prove is that the
// callable actually CONSULTS them - that the licence check runs before a PDF
// is built, that the refusal comes back as permission-denied rather than a
// 500, and that a permitted call really does queue a mail document with an
// attachment on it. A gate that is never reached looks exactly like a gate
// that passes.
//
// Charter area: reader <-> functions seam - who may receive lesson content by
// email, and who may start a group.
const {test, before} = require("node:test");
const assert = require("node:assert/strict");
const {getDb, preflight, reseed, callCallable, signIn} =
  require("./helpers/emulator");

const PATRON = "patron@test.local";
const LICENSED_BOOK = "lib-book-0001";
const LICENSED_LESSON = "lib-lesson-0001";
const UNLICENSED_BOOK = "lib-book-0002";
const UNLICENSED_LESSON = "lib-lesson-0002";

let idToken;

/** Mail documents queued for this patron since a given moment. */
async function mailSince(atLeast) {
  const snap = await getDb().collection("mail").get();
  return snap.docs
    .map((d) => d.data())
    .filter((m) => m.to === PATRON && m.date && m.date.toMillis() >= atLeast);
}

before(async () => {
  await preflight();
  reseed();
  idToken = await signIn(PATRON);
});

test("emailLessonPdf refuses a book the patron holds no licence for", async () => {
  // The check that matters most: this function runs with admin credentials
  // and would otherwise mail any lesson in the library to any account holder.
  const res = await callCallable(
    "emailLessonPdf",
    {bookId: UNLICENSED_BOOK, lessonId: UNLICENSED_LESSON},
    idToken
  );

  assert.equal(res.result, undefined);
  assert.equal(res.error?.status, "PERMISSION_DENIED");
});

test("emailLessonPdf refuses an unauthenticated caller", async () => {
  const res = await callCallable(
    "emailLessonPdf",
    {bookId: LICENSED_BOOK, lessonId: LICENSED_LESSON},
    undefined
  );

  assert.equal(res.result, undefined);
  assert.equal(res.error?.status, "UNAUTHENTICATED");
});

test("emailLessonPdf rejects a call with no book or lesson", async () => {
  const res = await callCallable("emailLessonPdf", {}, idToken);
  assert.equal(res.error?.status, "INVALID_ARGUMENT");
});

test("emailLessonPdf reports a lesson that does not exist as not-found", async () => {
  // Distinct from permission-denied on purpose: the patron IS licensed here,
  // so telling them it is a permissions problem would send them to support
  // over a stale link.
  const res = await callCallable(
    "emailLessonPdf",
    {bookId: LICENSED_BOOK, lessonId: "no-such-lesson"},
    idToken
  );
  assert.equal(res.error?.status, "NOT_FOUND");
});

test("emailLessonPdf queues a PDF to the patron's own address", async () => {
  const startedAt = Date.now();
  const res = await callCallable(
    "emailLessonPdf",
    {bookId: LICENSED_BOOK, lessonId: LICENSED_LESSON},
    idToken
  );

  assert.equal(res.error, undefined);
  assert.equal(res.result.sentTo, PATRON);

  const queued = await mailSince(startedAt);
  assert.equal(queued.length, 1, "exactly one mail document");

  const message = queued[0].message;
  assert.ok(
    message.subject.includes("Lesson 1: Why Multiply"),
    `subject names the lesson: ${message.subject}`
  );
  const attachments = message.attachments || [];
  assert.equal(attachments.length, 1);
  assert.ok(attachments[0].filename.endsWith(".pdf"));
  assert.equal(attachments[0].encoding, "base64");
  assert.ok(attachments[0].content.length > 0, "the PDF has content");

  // A real PDF, not an empty buffer or an error page: every PDF begins %PDF-.
  const head = Buffer.from(attachments[0].content, "base64")
    .subarray(0, 5).toString("latin1");
  assert.equal(head, "%PDF-");
});

test("emailLessonPdf sends to the CALLER, never to an address in the request", async () => {
  // The recipient is resolved from the auth token. If this ever became a
  // parameter, the function would be a way to mail lessons to strangers.
  const startedAt = Date.now();
  const res = await callCallable(
    "emailLessonPdf",
    {
      bookId: LICENSED_BOOK,
      lessonId: LICENSED_LESSON,
      to: "attacker@example.com",
      email: "attacker@example.com",
    },
    idToken
  );

  assert.equal(res.result.sentTo, PATRON);
  const queued = await mailSince(startedAt);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].to, PATRON);
});

test("createGroup refuses a patron whose canLeadGroups is false", async () => {
  // Every account carries true today, so this is the path nothing else runs.
  const ref = getDb().collection("libraryUsers").doc(PATRON);
  await ref.update({canLeadGroups: false});
  try {
    const res = await callCallable(
      "createGroup",
      {
        bookId: LICENSED_BOOK,
        title: "Tuesday Night",
        startDate: Date.now(),
        startTimeZone: "America/New_York",
        creatorDisplayName: "Pat",
      },
      idToken
    );
    assert.equal(res.result, undefined);
    assert.equal(res.error?.status, "PERMISSION_DENIED");
  } finally {
    await ref.update({canLeadGroups: true});
  }
});

test("createGroup allows a patron whose canLeadGroups is true", async () => {
  const res = await callCallable(
    "createGroup",
    {
      bookId: LICENSED_BOOK,
      title: "Allowed Group",
      startDate: Date.now(),
      startTimeZone: "America/New_York",
      creatorDisplayName: "Pat",
    },
    idToken
  );

  assert.equal(res.error, undefined, JSON.stringify(res.error));
  assert.ok(res.result.groupId, "a group id comes back");
});

test("createGroup allows a patron with the field absent entirely", async () => {
  // ABSENT MEANS ALLOWED - a profile written before the field existed must not
  // lose something it could do yesterday.
  // Resolved from functions/, the way helpers/emulator.js does - firebase-admin
  // is not installed at the repo root.
  const path = require("path");
  const {FieldValue} = require(
    require.resolve("firebase-admin/firestore", {
      paths: [path.join(__dirname, "..", "functions")],
    })
  );
  const ref = getDb().collection("libraryUsers").doc(PATRON);
  await ref.update({canLeadGroups: FieldValue.delete()});

  const res = await callCallable(
    "createGroup",
    {
      bookId: LICENSED_BOOK,
      title: "Absent Flag Group",
      startDate: Date.now(),
      startTimeZone: "America/New_York",
      creatorDisplayName: "Pat",
    },
    idToken
  );

  assert.equal(res.error, undefined, JSON.stringify(res.error));
  assert.ok(res.result.groupId);
});

test("createGroup still refuses a book the patron is not licensed for", async () => {
  // The flag is an ADDITIONAL gate, not a replacement for the licence check.
  const res = await callCallable(
    "createGroup",
    {
      bookId: UNLICENSED_BOOK,
      title: "Unlicensed Group",
      startDate: Date.now(),
      startTimeZone: "America/New_York",
      creatorDisplayName: "Pat",
    },
    idToken
  );

  assert.equal(res.result, undefined);
  assert.equal(res.error?.status, "PERMISSION_DENIED");
});
