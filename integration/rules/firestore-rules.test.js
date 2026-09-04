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
const {tenantPath} = require("../../scripts/lib/tenancy");

/**
 * A slash-joined Firestore path with its FIRST segment resolved through the
 * tenancy seam - `p("libraryUsers/x")` becomes
 * `tenants/{id}/libraryUsers/x`, while `p("errorLogs/x")` is unchanged
 * because errorLogs never moves.
 *
 * WHY EVERY PATH IN THIS FILE GOES THROUGH IT. These tests seed the very
 * documents the rules `get()` against, so when a collection moved and the
 * fixture did not, `hasBookLicense()` looked in the new place, found
 * nothing, and denied a patron the book they own. That is the paywall
 * failing OPEN-shut - the most important rule in the file - and it showed
 * up as one red test rather than as anything a reader would recognise.
 *
 * The seam also makes this file survive the next move on its own: a
 * hardcoded path passes until the day it silently tests nothing.
 */
const p = (s) => {
  const i = s.indexOf("/");
  return i === -1 ? tenantPath(s) : tenantPath(s.slice(0, i)) + s.slice(i);
};
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
    await setDoc(doc(db, p("libraryUsers/patron@test.local")), {
      email: "patron@test.local",
      licensedBookIds: ["book-licensed"],
      bookLicenses: [],
    });
    await setDoc(doc(db, p("librarySeries/s1/books/book-licensed/units/u1")), {title: "Unit 1"});
    await setDoc(doc(db, p("librarySeries/s1/books/book-unlicensed/units/u1")), {title: "Unit 1"});
    await setDoc(doc(db, p("products/p1")), {title: "Book", isActive: true});
    await setDoc(doc(db, p("site_navigation/main")), {
      items: [{id: "nav-home", title: "Home", kind: "page", routeKey: "home", visible: true}],
    });
    await setDoc(doc(db, p("site_footer/main")), {brandTitle: "Impact Discipleship Ministries", columns: []});
    await setDoc(doc(db, p("customers/c1")), {email: "c1@x.test"});
    await setDoc(doc(db, p("coupons/FREE")), {code: "FREE", percentOff: 100});
    // An already-sent mail doc, so the resend path (clear `delivery` and
    // write it back) can be exercised as an UPDATE rather than a create.
    await setDoc(doc(db, p("mail/m-sent")), {
      to: "someone@x.test", date: Timestamp.now(),
      message: {subject: "receipt", html: "<p>hi</p>", text: "hi"},
      delivery: {state: "SUCCESS"},
    });
    await setDoc(doc(db, p("purchases/o1")), {total: 10});
    await setDoc(doc(db, p("admin_users/a1")), {email: "admin@test.local"});
    // The self-preferences carve-out compares resource.data.firebaseUID to
    // the caller's uid, so these two need a real one. a1 above deliberately
    // does NOT have one - a doc with no firebaseUID must never match
    // somebody's own doc by accident.
    await setDoc(doc(db, p("admin_users/a-emp")), {
      email: "employee@test.local", firebaseUID: "employee-uid", role: "Employee",
    });
    await setDoc(doc(db, p("admin_users/a-edt")), {
      email: "editor@test.local", firebaseUID: "editor-uid", role: "Editor",
    });
    await setDoc(doc(db, p("eventSessionCounts/e1")), {counts: {}});
    await setDoc(doc(db, p("campaign_offers/camp1")), {
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
  await assertSucceeds(getDoc(doc(anon(), p("products/p1"))));
  await assertFails(setDoc(doc(anon(), p("products/p-new")), {title: "nope"}));
});

// The site's own top menu (2026-08-29). More load-bearing than most public
// content: an unreadable navigation document is a site with no menu on every
// page, and a writable one is somebody else choosing where your navigation
// points - a phishing surface rather than a content one.
test("anon: the site navigation is readable by a visitor, and writable by nobody", async () => {
  await assertSucceeds(getDoc(doc(anon(), p("site_navigation/main"))));
  await assertFails(setDoc(doc(anon(), p("site_navigation/main")), {items: []}));
  await assertFails(updateDoc(doc(anon(), p("site_navigation/main")), {
    items: [{id: "x", title: "Donate", kind: "custom", url: "https://evil.test", visible: true}],
  }));
  await assertFails(deleteDoc(doc(anon(), p("site_navigation/main"))));
});

test("anon: the site footer is readable by a visitor, and writable by nobody", async () => {
  await assertSucceeds(getDoc(doc(anon(), p("site_footer/main"))));
  await assertFails(setDoc(doc(anon(), p("site_footer/main")), {columns: []}));
  await assertFails(updateDoc(doc(anon(), p("site_footer/main")), {
    bottomLinkUrl: "https://evil.test",
  }));
});

test("business staff may edit the site footer; an Editor may not", async () => {
  await assertSucceeds(updateDoc(doc(admin(), p("site_footer/main")), {brandTitle: "X"}));
  await assertSucceeds(updateDoc(doc(employee(), p("site_footer/main")), {brandTitle: "Y"}));
  await assertFails(updateDoc(doc(editor(), p("site_footer/main")), {brandTitle: "Z"}));
});

test("business staff may edit the site navigation; an Editor may not", async () => {
  // Editors are the library tier - nothing on the public marketing site is
  // theirs, and the menu is the most visible thing on it.
  await assertSucceeds(updateDoc(doc(admin(), p("site_navigation/main")), {items: []}));
  await assertSucceeds(updateDoc(doc(employee(), p("site_navigation/main")), {items: []}));
  await assertFails(updateDoc(doc(editor(), p("site_navigation/main")), {items: []}));
});

test("anon: the retired sales collection is closed to everyone", async () => {
  // Sales are gone (Campaign Manager v3) - discounts come from
  // campaign_offers now. The rule is deny-all so the leftover documents are
  // unreachable rather than quietly public while they wait to be deleted.
  await assertFails(getDoc(doc(anon(), p("sales/s1"))));
  await assertFails(getDocs(collection(anon(), p("sales"))));
});

test("anon: campaign offers are public to read, never writable", async () => {
  // A price a shopper sees has to be readable without auth - campaign docs
  // are staff-only, so the offer is what the storefront reads instead.
  await assertSucceeds(getDoc(doc(anon(), p("campaign_offers/camp1"))));
  await assertSucceeds(getDocs(collection(anon(), p("campaign_offers"))));
  // ...but nobody unauthenticated may mint themselves a discount.
  await assertFails(setDoc(doc(anon(), p("campaign_offers/camp-new")), {
    campaignId: "camp-new", isActive: true,
    target: {kind: "product", id: "p1"},
    discount: {type: "percentOff", value: 100},
  }));
});

test("anon: coupons are NOT enumerable (code enumeration lockdown)", async () => {
  await assertFails(getDoc(doc(anon(), p("coupons/FREE"))));
  await assertFails(getDocs(collection(anon(), p("coupons"))));
});

test("anon: customers, purchases, event-registrations all closed", async () => {
  await assertFails(getDoc(doc(anon(), p("customers/c1"))));
  await assertFails(getDoc(doc(anon(), p("purchases/o1"))));
  await assertFails(setDoc(doc(anon(), p("event-registrations/r-new")), {
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
  await assertSucceeds(setDoc(doc(anon(), p("form_submissions/ok")), valid));
  // One extra key sinks the whole write (hasOnly shape lock).
  await assertFails(setDoc(doc(anon(), p("form_submissions/extra")), {
    ...valid, sneaky: true,
  }));
  // Wrong type on a locked field.
  await assertFails(setDoc(doc(anon(), p("form_submissions/badtype")), {
    ...valid, formId: 42,
  }));
  // Anonymous can never read back.
  await assertFails(getDoc(doc(anon(), p("form_submissions/ok"))));
});

// Finding S7, second half (2026-08-28). onFormSubmissionCreated skips any
// doc that ARRIVES carrying newRecordStatus, so a client able to send it
// could silence the staff alert bell - and the three writers that sent
// 'new' legitimately meant no public submission was ever counted at all.
// The trigger is the field's only writer now, so the key is refused.
test("anon: form_submissions cannot set newRecordStatus at all", async () => {
  const valid = validSubmission();
  // 'seen' was the suppression primitive...
  await assertFails(setDoc(doc(anon(), p("form_submissions/seen")), {
    ...valid, newRecordStatus: "seen",
  }));
  // ...and 'new' is refused too: it is not the client's field to set, and
  // sending it is what made the trigger skip the doc.
  await assertFails(setDoc(doc(anon(), p("form_submissions/new")), {
    ...valid, newRecordStatus: "new",
  }));
});

test("anon: a test-flagged submission is still a valid shape", async () => {
  // The admin builder's test submit keeps isTest; the bell is now kept
  // quiet by the trigger reading THAT, not by pre-setting the field it
  // owns. Staff create it, but creates are not role-gated here, so the
  // shape has to stay legal.
  await assertSucceeds(setDoc(doc(anon(), p("form_submissions/t1")), {
    ...validSubmission(), isTest: true,
  }));
  await assertFails(setDoc(doc(anon(), p("form_submissions/t2")), {
    ...validSubmission(), isTest: "yes",
  }));
});

test("anon: mail create is closed (no open email relay)", async () => {
  await assertFails(setDoc(doc(anon(), p("mail/m1")), {
    to: "victim@x.test", date: Timestamp.now(),
    message: {subject: "spam", html: "<p>spam</p>", text: "spam"},
  }));
});

test("anon: log-messages create allowed in shape (pre-auth failed logins)", async () => {
  await assertSucceeds(setDoc(doc(anon(), p("log-messages/l1")), {
    id: "l1", date: Timestamp.now(), type: "LOGIN",
    message: "failed login", error_code: "auth/wrong-password",
    archived: false,
  }));
  await assertFails(setDoc(doc(anon(), p("log-messages/l2")), {
    id: "l2", date: Timestamp.now(), type: "LOGIN",
    message: "x", error_code: "y", archived: false, extra: "nope",
  }));
  // And the anonymous writer may NOT read it back - which is why
  // LoggerService must create without a read-back (2026-09-04: add()'s
  // read-back was refused here and left the login screen spinning).
  await assertFails(getDoc(doc(anon(), p("log-messages/l1"))));
});

test("anon: eventSessionCounts falls to the default deny", async () => {
  await assertFails(getDoc(doc(anon(), p("eventSessionCounts/e1"))));
});

// ---- Staff tiers ------------------------------------------------------------

test("Admin claim: business collections open; purchases create still closed", async () => {
  await assertSucceeds(getDoc(doc(admin(), p("customers/c1"))));
  await assertSucceeds(setDoc(doc(admin(), p("customers/c-new")), {email: "n@x.test"}));
  await assertSucceeds(updateDoc(doc(admin(), p("purchases/o1")), {fulfillmentStatus: "received"}));
  // Functions-only creates stay closed even for Admin.
  await assertFails(setDoc(doc(admin(), p("purchases/o-new")), {total: 5}));
  await assertFails(deleteDoc(doc(admin(), p("purchases/o1"))));
});

test("Admin claim: admin_users update yes, create/delete never (functions only)", async () => {
  await assertSucceeds(updateDoc(doc(admin(), p("admin_users/a1")), {firstName: "A"}));
  await assertFails(setDoc(doc(admin(), p("admin_users/a-new")), {email: "n@x.test"}));
  await assertFails(deleteDoc(doc(admin(), p("admin_users/a1"))));
});

// SELF-PREFERENCES CARVE-OUT (2026-08-29), added with the drawer's
// drag-to-resize. The whole value of the carve-out is that it is NARROW, so
// most of these assert what it still refuses. If any of the "no" cases ever
// goes green, an Employee can edit part of the staff registry.
test("Staff may save their OWN nav/appearance preferences", async () => {
  await assertSucceeds(updateDoc(doc(employee(), p("admin_users/a-emp")), {drawerWidth: 380}));
  await assertSucceeds(updateDoc(doc(employee(), p("admin_users/a-emp")), {drawerPinned: false}));
  await assertSucceeds(updateDoc(doc(employee(), p("admin_users/a-emp")), {
    pinnedScreens: ["page-manager.give"],
  }));
  await assertSucceeds(updateDoc(doc(employee(), p("admin_users/a-emp")), {colorTheme: "horizon"}));
  // Their own NAME, added with Settings > My Profile - an Employee should
  // not have to ask an Admin to correct the spelling of their own name.
  await assertSucceeds(updateDoc(doc(employee(), p("admin_users/a-emp")), {
    firstName: "Sam", lastName: "Taylor",
  }));
  // Editors too - they are the audience for the flattened Library tab.
  await assertSucceeds(updateDoc(doc(editor(), p("admin_users/a-edt")), {drawerWidth: 420}));
  // Several at once is still fine; it is the KEY SET that is restricted.
  await assertSucceeds(updateDoc(doc(employee(), p("admin_users/a-emp")), {
    drawerWidth: 300, drawerPinned: true,
  }));
});

test("The carve-out does NOT open self-escalation", async () => {
  // The claim that gates everything else in this file.
  await assertFails(updateDoc(doc(employee(), p("admin_users/a-emp")), {role: "Admin"}));
  await assertFails(updateDoc(doc(employee(), p("admin_users/a-emp")), {
    permissions: [{screenKey: "store-manager.products", view: true}],
  }));
  await assertFails(updateDoc(doc(editor(), p("admin_users/a-edt")), {
    libraryPermissions: [{nodeId: "*", edit: true}],
  }));
  // Identity is how the app resolves who you are - not a preference.
  await assertFails(updateDoc(doc(employee(), p("admin_users/a-emp")), {email: "admin@test.local"}));
  await assertFails(updateDoc(doc(employee(), p("admin_users/a-emp")), {firebaseUID: "admin-uid"}));
  // One allowed key does not smuggle a disallowed one through - hasOnly.
  await assertFails(updateDoc(doc(employee(), p("admin_users/a-emp")), {
    drawerWidth: 300, role: "Admin",
  }));
  // The name being writable must not drag the identity fields along with it.
  await assertFails(updateDoc(doc(employee(), p("admin_users/a-emp")), {
    firstName: "Sam", email: "admin@test.local",
  }));
});

test("Renaming yourself does not let you rename anyone else", async () => {
  await assertFails(updateDoc(doc(employee(), p("admin_users/a-edt")), {firstName: "Nope"}));
  await assertFails(updateDoc(doc(editor(), p("admin_users/a1")), {firstName: "Nope"}));
});

test("The carve-out is limited to your OWN document", async () => {
  // Somebody else's doc, and a doc with no firebaseUID at all.
  await assertFails(updateDoc(doc(employee(), p("admin_users/a-edt")), {drawerWidth: 380}));
  await assertFails(updateDoc(doc(editor(), p("admin_users/a-emp")), {drawerWidth: 380}));
  await assertFails(updateDoc(doc(employee(), p("admin_users/a1")), {drawerWidth: 380}));
  // And create/delete stay shut for everyone, carve-out or not.
  await assertFails(setDoc(doc(employee(), p("admin_users/a-mine")), {
    email: "employee@test.local", firebaseUID: "employee-uid", drawerWidth: 380,
  }));
  await assertFails(deleteDoc(doc(employee(), p("admin_users/a-emp"))));
});

test("Employee claim: business staff yes, admin-only collections no", async () => {
  await assertSucceeds(getDoc(doc(employee(), p("customers/c1"))));
  await assertSucceeds(getDoc(doc(employee(), p("coupons/FREE"))));
  await assertFails(updateDoc(doc(employee(), p("admin_users/a1")), {role: "Admin"}));
});

// Sweep finding S2 (2026-08-28). Per-screen Employee grants are advisory -
// rules cannot see them - so the two collections that carry real money and
// real outbound email sit one tier higher than the rest of business staff.
// Reads stay open: the Coupons screen and Email History still list.
test("Employee claim: coupons are readable but not writable", async () => {
  await assertSucceeds(getDoc(doc(employee(), p("coupons/FREE"))));
  await assertFails(setDoc(doc(employee(), p("coupons/NEW")), {code: "NEW", percentOff: 100}));
  await assertFails(updateDoc(doc(employee(), p("coupons/FREE")), {percentOff: 100}));
  await assertFails(deleteDoc(doc(employee(), p("coupons/FREE"))));
});

test("Employee claim: cannot send mail, and cannot resend one either", async () => {
  await assertSucceeds(getDoc(doc(employee(), p("mail/m-sent"))));
  // Creating a mail doc IS sending it - the Trigger Email extension
  // dispatches whatever lands in this collection.
  await assertFails(setDoc(doc(employee(), p("mail/m-emp")), {
    to: "victim@x.test", date: Timestamp.now(),
    message: {subject: "spam", html: "<p>spam</p>", text: "spam"},
  }));
  // And clearing `delivery` on an existing doc re-dispatches it, so an
  // update is a send too. This is the half the original finding missed.
  await assertFails(updateDoc(doc(employee(), p("mail/m-sent")), {delivery: null}));
});

test("Admin claim: may still write coupons and send/resend mail", async () => {
  await assertSucceeds(setDoc(doc(admin(), p("coupons/NEW")), {code: "NEW", percentOff: 10}));
  await assertSucceeds(setDoc(doc(admin(), p("mail/m-admin")), {
    to: "ok@x.test", date: Timestamp.now(),
    message: {subject: "hi", html: "<p>hi</p>", text: "hi"},
  }));
  await assertSucceeds(updateDoc(doc(admin(), p("mail/m-sent")), {delivery: null}));
});

test("Editor claim: library authoring yes, business world no", async () => {
  await assertSucceeds(setDoc(doc(editor(), p("librarySeries/s1")), {title: "S1"}));
  await assertFails(getDoc(doc(editor(), p("customers/c1"))));
  await assertFails(getDoc(doc(editor(), p("purchases/o1"))));
});

// ---- Reader patrons ----------------------------------------------------------

test("patron: own libraryUsers doc readable, others not, writes closed", async () => {
  await assertSucceeds(getDoc(doc(patron(), p("libraryUsers/patron@test.local"))));
  await assertFails(getDoc(doc(patron(), p("libraryUsers/someone-else@test.local"))));
  await assertFails(updateDoc(doc(patron(), p("libraryUsers/patron@test.local")), {
    licensedBookIds: ["book-licensed", "book-unlicensed"], // self-grant attack
  }));
});

test("patron: unit content gated by the flat licensedBookIds array", async () => {
  await assertSucceeds(getDoc(
    doc(patron(), p("librarySeries/s1/books/book-licensed/units/u1"))));
  await assertFails(getDoc(
    doc(patron(), p("librarySeries/s1/books/book-unlicensed/units/u1"))));
});

test("patron: book METADATA readable regardless of license (Groups browses)", async () => {
  await assertSucceeds(getDoc(
    doc(patron(), p("librarySeries/s1/books/book-unlicensed"))));
});

test("patron: business collections invisible (public catalog still fine)", async () => {
  await assertFails(getDoc(doc(patron(), p("customers/c1"))));
  await assertFails(getDoc(doc(patron(), p("campaigns/any"))));
  // products IS public - a patron reads it like anyone else.
  await assertSucceeds(getDoc(doc(patron(), p("products/p1"))));
});
