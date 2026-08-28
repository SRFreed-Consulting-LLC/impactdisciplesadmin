// Firestore security-rules tests over the admin-owned firestore.rules -
// the single rules file for all three client populations (anonymous web,
// claim-carrying staff, email-keyed reader patrons). Runs against the
// Firestore emulator under its OWN project id (demo-rules), so it never
// touches the integration suites' demo-impact data and can run alongside
// them. `npm run test:rules` (emulator must be up - npm run emu).
//
// Identity model under test (see firestore.rules header): staff = the
// `role` CUSTOM CLAIM ('Admin'|'Root'|'Employee'|'Editor'), patrons = the
// token email, anonymous = no auth at all.
const {test, before, after} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs,
  Timestamp,
} = require("firebase/firestore");

let env;

// Per-population Firestore handles.
const anon = () => env.unauthenticatedContext().firestore();
const admin = () => env.authenticatedContext("admin-uid",
  {email: "admin@test.local", role: "Admin"}).firestore();
const employee = () => env.authenticatedContext("employee-uid",
  {email: "employee@test.local", role: "Employee"}).firestore();
const editor = () => env.authenticatedContext("editor-uid",
  {email: "editor@test.local", role: "Editor"}).firestore();
const patron = () => env.authenticatedContext("patron-uid",
  {email: "patron@test.local"}).firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-rules",
    firestore: {
      rules: fs.readFileSync(
        path.join(__dirname, "..", "..", "firestore.rules"), "utf8"),
      host: "localhost",
      port: 8080,
    },
  });
  // The demo-rules namespace PERSISTS across runs within one emulator
  // session - without this, a second run's setDoc on a doc created by the
  // first run is an UPDATE (different permission) and create-shape tests
  // fail confusingly. Always start empty.
  await env.clearFirestore();
  // Seed the docs the license/ownership rules get() against, bypassing
  // rules entirely.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "libraryUsers/patron@test.local"), {
      email: "patron@test.local",
      licensedBookIds: ["book-licensed"],
      bookLicenses: [],
    });
    await setDoc(doc(db,
      "librarySeries/s1/books/book-licensed/units/u1"), {title: "Unit 1"});
    await setDoc(doc(db,
      "librarySeries/s1/books/book-unlicensed/units/u1"), {title: "Unit 1"});
    await setDoc(doc(db, "products/p1"), {title: "Book", isActive: true});
    await setDoc(doc(db, "customers/c1"), {email: "c1@x.test"});
    await setDoc(doc(db, "coupons/FREE"), {code: "FREE", percentOff: 100});
    // An already-sent mail doc, so the resend path (clear `delivery` and
    // write it back) can be exercised as an UPDATE rather than a create.
    await setDoc(doc(db, "mail/m-sent"), {
      to: "someone@x.test", date: Timestamp.now(),
      message: {subject: "receipt", html: "<p>hi</p>", text: "hi"},
      delivery: {state: "SUCCESS"},
    });
    await setDoc(doc(db, "purchases/o1"), {total: 10});
    await setDoc(doc(db, "admin_users/a1"), {email: "admin@test.local"});
    await setDoc(doc(db, "eventSessionCounts/e1"), {counts: {}});
    await setDoc(doc(db, "campaign_offers/camp1"), {
      campaignId: "camp1", isActive: true,
      target: {kind: "product", id: "p1"},
      discount: {type: "percentOff", value: 20},
    });
  });
});

after(async () => {
  await env.cleanup();
});

// ---- Anonymous (public web site) ------------------------------------------

test("anon: public catalog readable, never writable", async () => {
  await assertSucceeds(getDoc(doc(anon(), "products/p1")));
  await assertFails(setDoc(doc(anon(), "products/p-new"), {title: "nope"}));
});

test("anon: the retired sales collection is closed to everyone", async () => {
  // Sales are gone (Campaign Manager v3) - discounts come from
  // campaign_offers now. The rule is deny-all so the leftover documents are
  // unreachable rather than quietly public while they wait to be deleted.
  await assertFails(getDoc(doc(anon(), "sales/s1")));
  await assertFails(getDocs(collection(anon(), "sales")));
});

test("anon: campaign offers are public to read, never writable", async () => {
  // A price a shopper sees has to be readable without auth - campaign docs
  // are staff-only, so the offer is what the storefront reads instead.
  await assertSucceeds(getDoc(doc(anon(), "campaign_offers/camp1")));
  await assertSucceeds(getDocs(collection(anon(), "campaign_offers")));
  // ...but nobody unauthenticated may mint themselves a discount.
  await assertFails(setDoc(doc(anon(), "campaign_offers/camp-new"), {
    campaignId: "camp-new", isActive: true,
    target: {kind: "product", id: "p1"},
    discount: {type: "percentOff", value: 100},
  }));
});

test("anon: coupons are NOT enumerable (code enumeration lockdown)", async () => {
  await assertFails(getDoc(doc(anon(), "coupons/FREE")));
  await assertFails(getDocs(collection(anon(), "coupons")));
});

test("anon: customers, purchases, event-registrations all closed", async () => {
  await assertFails(getDoc(doc(anon(), "customers/c1")));
  await assertFails(getDoc(doc(anon(), "purchases/o1")));
  await assertFails(setDoc(doc(anon(), "event-registrations/r-new"), {
    firstName: "X", lastName: "Y", email: "x@y.test", eventId: "e1",
  }));
});

const validSubmission = () => ({
  formId: "form-1",
  formName: "Contact Us",
  fieldSnapshot: [],
  values: {message: "hi"},
  submittedAt: Timestamp.now(),
});

test("anon: form_submissions create allowed ONLY in the exact shape", async () => {
  const valid = validSubmission();
  await assertSucceeds(setDoc(doc(anon(), "form_submissions/ok"), valid));
  // One extra key sinks the whole write (hasOnly shape lock).
  await assertFails(setDoc(doc(anon(), "form_submissions/extra"), {
    ...valid, sneaky: true,
  }));
  // Wrong type on a locked field.
  await assertFails(setDoc(doc(anon(), "form_submissions/badtype"), {
    ...valid, formId: 42,
  }));
  // Anonymous can never read back.
  await assertFails(getDoc(doc(anon(), "form_submissions/ok")));
});

// Finding S7, second half (2026-08-28). onFormSubmissionCreated skips any
// doc that ARRIVES carrying newRecordStatus, so a client able to send it
// could silence the staff alert bell - and the three writers that sent
// 'new' legitimately meant no public submission was ever counted at all.
// The trigger is the field's only writer now, so the key is refused.
test("anon: form_submissions cannot set newRecordStatus at all", async () => {
  const valid = validSubmission();
  // 'seen' was the suppression primitive...
  await assertFails(setDoc(doc(anon(), "form_submissions/seen"), {
    ...valid, newRecordStatus: "seen",
  }));
  // ...and 'new' is refused too: it is not the client's field to set, and
  // sending it is what made the trigger skip the doc.
  await assertFails(setDoc(doc(anon(), "form_submissions/new"), {
    ...valid, newRecordStatus: "new",
  }));
});

test("anon: a test-flagged submission is still a valid shape", async () => {
  // The admin builder's test submit keeps isTest; the bell is now kept
  // quiet by the trigger reading THAT, not by pre-setting the field it
  // owns. Staff create it, but creates are not role-gated here, so the
  // shape has to stay legal.
  await assertSucceeds(setDoc(doc(anon(), "form_submissions/t1"), {
    ...validSubmission(), isTest: true,
  }));
  await assertFails(setDoc(doc(anon(), "form_submissions/t2"), {
    ...validSubmission(), isTest: "yes",
  }));
});

test("anon: mail create is closed (no open email relay)", async () => {
  await assertFails(setDoc(doc(anon(), "mail/m1"), {
    to: "victim@x.test", date: Timestamp.now(),
    message: {subject: "spam", html: "<p>spam</p>", text: "spam"},
  }));
});

test("anon: log-messages create allowed in shape (pre-auth failed logins)", async () => {
  await assertSucceeds(setDoc(doc(anon(), "log-messages/l1"), {
    id: "l1", date: Timestamp.now(), type: "LOGIN",
    message: "failed login", error_code: "auth/wrong-password",
    archived: false,
  }));
  await assertFails(setDoc(doc(anon(), "log-messages/l2"), {
    id: "l2", date: Timestamp.now(), type: "LOGIN",
    message: "x", error_code: "y", archived: false, extra: "nope",
  }));
});

test("anon: eventSessionCounts falls to the default deny", async () => {
  await assertFails(getDoc(doc(anon(), "eventSessionCounts/e1")));
});

// ---- Staff tiers ------------------------------------------------------------

test("Admin claim: business collections open; purchases create still closed", async () => {
  await assertSucceeds(getDoc(doc(admin(), "customers/c1")));
  await assertSucceeds(setDoc(doc(admin(), "customers/c-new"), {email: "n@x.test"}));
  await assertSucceeds(updateDoc(doc(admin(), "purchases/o1"), {fulfillmentStatus: "received"}));
  // Functions-only creates stay closed even for Admin.
  await assertFails(setDoc(doc(admin(), "purchases/o-new"), {total: 5}));
  await assertFails(deleteDoc(doc(admin(), "purchases/o1")));
});

test("Admin claim: admin_users update yes, create/delete never (functions only)", async () => {
  await assertSucceeds(updateDoc(doc(admin(), "admin_users/a1"), {firstName: "A"}));
  await assertFails(setDoc(doc(admin(), "admin_users/a-new"), {email: "n@x.test"}));
  await assertFails(deleteDoc(doc(admin(), "admin_users/a1")));
});

test("Employee claim: business staff yes, admin-only collections no", async () => {
  await assertSucceeds(getDoc(doc(employee(), "customers/c1")));
  await assertSucceeds(getDoc(doc(employee(), "coupons/FREE")));
  await assertFails(updateDoc(doc(employee(), "admin_users/a1"), {role: "Admin"}));
});

// Sweep finding S2 (2026-08-28). Per-screen Employee grants are advisory -
// rules cannot see them - so the two collections that carry real money and
// real outbound email sit one tier higher than the rest of business staff.
// Reads stay open: the Coupons screen and Email History still list.
test("Employee claim: coupons are readable but not writable", async () => {
  await assertSucceeds(getDoc(doc(employee(), "coupons/FREE")));
  await assertFails(setDoc(doc(employee(), "coupons/NEW"), {code: "NEW", percentOff: 100}));
  await assertFails(updateDoc(doc(employee(), "coupons/FREE"), {percentOff: 100}));
  await assertFails(deleteDoc(doc(employee(), "coupons/FREE")));
});

test("Employee claim: cannot send mail, and cannot resend one either", async () => {
  await assertSucceeds(getDoc(doc(employee(), "mail/m-sent")));
  // Creating a mail doc IS sending it - the Trigger Email extension
  // dispatches whatever lands in this collection.
  await assertFails(setDoc(doc(employee(), "mail/m-emp"), {
    to: "victim@x.test", date: Timestamp.now(),
    message: {subject: "spam", html: "<p>spam</p>", text: "spam"},
  }));
  // And clearing `delivery` on an existing doc re-dispatches it, so an
  // update is a send too. This is the half the original finding missed.
  await assertFails(updateDoc(doc(employee(), "mail/m-sent"), {delivery: null}));
});

test("Admin claim: may still write coupons and send/resend mail", async () => {
  await assertSucceeds(setDoc(doc(admin(), "coupons/NEW"), {code: "NEW", percentOff: 10}));
  await assertSucceeds(setDoc(doc(admin(), "mail/m-admin"), {
    to: "ok@x.test", date: Timestamp.now(),
    message: {subject: "hi", html: "<p>hi</p>", text: "hi"},
  }));
  await assertSucceeds(updateDoc(doc(admin(), "mail/m-sent"), {delivery: null}));
});

test("Editor claim: library authoring yes, business world no", async () => {
  await assertSucceeds(setDoc(doc(editor(), "librarySeries/s1"), {title: "S1"}));
  await assertFails(getDoc(doc(editor(), "customers/c1")));
  await assertFails(getDoc(doc(editor(), "purchases/o1")));
});

// ---- Reader patrons ----------------------------------------------------------

test("patron: own libraryUsers doc readable, others not, writes closed", async () => {
  await assertSucceeds(getDoc(doc(patron(), "libraryUsers/patron@test.local")));
  await assertFails(getDoc(doc(patron(), "libraryUsers/someone-else@test.local")));
  await assertFails(updateDoc(doc(patron(), "libraryUsers/patron@test.local"), {
    licensedBookIds: ["book-licensed", "book-unlicensed"], // self-grant attack
  }));
});

test("patron: unit content gated by the flat licensedBookIds array", async () => {
  await assertSucceeds(getDoc(
    doc(patron(), "librarySeries/s1/books/book-licensed/units/u1")));
  await assertFails(getDoc(
    doc(patron(), "librarySeries/s1/books/book-unlicensed/units/u1")));
});

test("patron: book METADATA readable regardless of license (Groups browses)", async () => {
  await assertSucceeds(getDoc(
    doc(patron(), "librarySeries/s1/books/book-unlicensed")));
});

test("patron: business collections invisible (public catalog still fine)", async () => {
  await assertFails(getDoc(doc(patron(), "customers/c1")));
  await assertFails(getDoc(doc(patron(), "campaigns/any")));
  // products IS public - a patron reads it like anyone else.
  await assertSucceeds(getDoc(doc(patron(), "products/p1")));
});
