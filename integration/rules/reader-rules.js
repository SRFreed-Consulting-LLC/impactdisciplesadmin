/**
 * Firestore Security Rules tests for the READER-app population (email-keyed
 * patrons) over this repo's own firestore.rules.
 *
 * Moved here from the reader repo on 2026-08-21 (refactor sweep bucket B):
 * it already read this repo's rules by a cross-repo relative path, so it
 * now lives beside the file it tests and can never be run against a stale
 * copy. Its sibling, firestore-rules.test.js, covers the staff/anonymous
 * populations - together they are the rules suite. Set RULES_FILE to
 * override the path.
 *
 * Run BOTH with `npm run test:rules` (needs the emulator up: `npm run emu`),
 * or this file alone with `node integration/rules/reader-rules.js`. It talks
 * to the Firestore emulator on 127.0.0.1:8080 under its own
 * `demo-reader-rules` project id, so it never touches the integration
 * suites' demo-impact data. Emulator needs Java.
 *
 * Deliberately NOT in the GitHub CI gate - CI has no emulator/Java.
 *
 * Coverage is deliberately focused on the security-critical rules the 2026-08
 * sweeps added/changed - the paywall (canReadBook), the DM push-spam hole,
 * the self-license-grant lockdown, roster/license/invite enumeration, the
 * pre-auth error-log exception, and the inbox message mutations - since those
 * are exactly the rules with real blast radius and, until now, zero automated
 * coverage.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');
const {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
} = require('firebase/firestore');

// ---- The rules file this repo owns and deploys ---------------------------
const RULES_FILE =
  process.env.RULES_FILE ||
  path.resolve(__dirname, '..', '..', 'firestore.rules');

if (!fs.existsSync(RULES_FILE)) {
  console.error(
    `\nCannot find firestore.rules at:\n  ${RULES_FILE}\n\n` +
      `Run this from the admin repo (which owns and deploys the rules), or\n` +
      `set RULES_FILE to point at a firestore.rules.\n`,
  );
  process.exit(2);
}

const host = '127.0.0.1';
const port = 8080;

// ---- Tiny test harness (matches the plain-node e2e script style) ---------
let testEnv;
let passed = 0;
let failed = 0;
const failures = [];
let currentSuite = '';

function describe(name) {
  currentSuite = name;
  console.log(`\n${name}`);
}
async function it(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    const msg = (e && e.message) || String(e);
    failures.push(`${currentSuite} > ${name}\n       ${msg}`);
    console.log(`  FAIL ${name}`);
  }
}

// ---- Context / seeding helpers -------------------------------------------
/** A signed-in patron identified by email (rules key off token.email.lower()). */
function patron(email) {
  return testEnv.authenticatedContext(email.replace(/[^a-z0-9]/gi, ''), { email }).firestore();
}
/** A signed-in staff member with a role claim. */
function staff(email, role) {
  return testEnv
    .authenticatedContext(email.replace(/[^a-z0-9]/gi, ''), { email, role })
    .firestore();
}
/** An anonymous (unauthenticated) client - request.auth == null. */
function anon() {
  return testEnv.unauthenticatedContext().firestore();
}
/** Seed docs with rules disabled (Admin-SDK-equivalent bootstrap). */
async function seed(fn) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => fn(ctx.firestore()));
}

// Common paths.
const UNIT = 'librarySeries/S1/books/BOOK_A/units/U1';
const LESSON = 'librarySeries/S1/books/BOOK_A/units/U1/lessons/L1';
const TRANSLATION =
  'librarySeries/S1/books/BOOK_A/units/U1/lessons/L1/translations/fr';
const BOOK = 'librarySeries/S1/books/BOOK_A';

async function seedLibrary() {
  await seed(async (db) => {
    await setDoc(doc(db, BOOK), { title: 'Book A' });
    await setDoc(doc(db, UNIT), { title: 'Unit 1', bookId: 'BOOK_A' });
    await setDoc(doc(db, LESSON), { title: 'Lesson 1' });
    await setDoc(doc(db, TRANSLATION), { locale: 'fr', text: 'secret full text' });
    // Licensed patron.
    await setDoc(doc(db, 'libraryUsers/licensed@example.com'), {
      licensedBookIds: ['BOOK_A'],
    });
    // Unlicensed patron (has a profile, but no license to BOOK_A).
    await setDoc(doc(db, 'libraryUsers/nolicense@example.com'), {
      licensedBookIds: ['SOME_OTHER_BOOK'],
    });
    // International patron - all-book access, no explicit license.
    await setDoc(doc(db, 'libraryUsers/intl@example.com'), {
      licensedBookIds: [],
      internationalUser: true,
    });
    // Revoked patron - HAS the license but access is revoked.
    await setDoc(doc(db, 'libraryUsers/revoked@example.com'), {
      licensedBookIds: ['BOOK_A'],
      revoked: true,
    });
  });
}

// ==========================================================================
async function main() {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-reader-rules',
    firestore: { rules: fs.readFileSync(RULES_FILE, 'utf8'), host, port },
  });

  // Start empty, every run. Without this the seeded docs survive from the
  // previous run, so a test's `create` is evaluated as an UPDATE - a
  // different rule with different constraints - and it fails with a
  // permission error that reads like a rules bug. It is not one: this
  // suite scored 31/31 on a fresh emulator and 28/31 on every run after,
  // and the three "known failures" that were carried as an open TODO from
  // 2026-08-22 to 2026-08-28 were only ever this. firestore-rules.test.js
  // already clears for the same reason - see its own comment.
  await testEnv.clearFirestore();

  // ---- Book license paywall (canReadBook) -------------------------------
  describe('Library content - license paywall (canReadBook)');
  await seedLibrary();

  await it('any signed-in patron may read a book\'s metadata (Groups needs unowned titles)', async () => {
    await assertSucceeds(getDoc(doc(patron('nolicense@example.com'), BOOK)));
  });
  await it('a licensed patron may read unit + lesson content', async () => {
    await assertSucceeds(getDoc(doc(patron('licensed@example.com'), UNIT)));
    await assertSucceeds(getDoc(doc(patron('licensed@example.com'), LESSON)));
  });
  await it('an UNlicensed patron may NOT read unit/lesson content', async () => {
    await assertFails(getDoc(doc(patron('nolicense@example.com'), UNIT)));
    await assertFails(getDoc(doc(patron('nolicense@example.com'), LESSON)));
  });
  await it('an international patron may read content without an explicit license', async () => {
    await assertSucceeds(getDoc(doc(patron('intl@example.com'), LESSON)));
  });
  await it('a REVOKED patron may NOT read content even though the license id is present', async () => {
    await assertFails(getDoc(doc(patron('revoked@example.com'), LESSON)));
  });
  await it('library staff (Editor) may read content without any license', async () => {
    await assertSucceeds(getDoc(doc(staff('editor@example.com', 'Editor'), LESSON)));
  });
  await it('an anonymous client may NOT read book metadata or content', async () => {
    await assertFails(getDoc(doc(anon(), BOOK)));
    await assertFails(getDoc(doc(anon(), LESSON)));
  });

  // ---- Translation paywall ----------------------------------------------
  describe('Translations - full-text paywall');
  await it('an UNlicensed patron may NOT read a lesson translation (full lesson text)', async () => {
    await assertFails(getDoc(doc(patron('nolicense@example.com'), TRANSLATION)));
  });
  await it('a licensed patron may read the translation', async () => {
    await assertSucceeds(getDoc(doc(patron('licensed@example.com'), TRANSLATION)));
  });

  // ---- libraryUsers profile: read-scope + write lockdown ----------------
  describe('libraryUsers profile - owner read, writes are functions-only');
  await it('the owner may read their own profile', async () => {
    await assertSucceeds(getDoc(doc(patron('licensed@example.com'), 'libraryUsers/licensed@example.com')));
  });
  await it('a different patron may NOT read someone else\'s profile', async () => {
    await assertFails(getDoc(doc(patron('nolicense@example.com'), 'libraryUsers/licensed@example.com')));
  });
  await it('NO client may write a profile (self-license-grant lockdown)', async () => {
    await assertFails(
      setDoc(doc(patron('licensed@example.com'), 'libraryUsers/licensed@example.com'), {
        licensedBookIds: ['BOOK_A', 'BOOK_STOLEN'],
      }),
    );
  });

  // ---- Owner study subcollections (stay-direct writes) ------------------
  describe('Owner study data - submissions subcollection');
  await it('the owner may write their own submission', async () => {
    await assertSucceeds(
      setDoc(doc(patron('licensed@example.com'), 'libraryUsers/licensed@example.com/submissions/L1'), {
        answers: { q1: 'a' },
      }),
    );
  });
  await it('another patron may NOT write into someone else\'s submissions', async () => {
    await assertFails(
      setDoc(doc(patron('nolicense@example.com'), 'libraryUsers/licensed@example.com/submissions/L1'), {
        answers: { q1: 'hijack' },
      }),
    );
  });

  // ---- Inbox messages: read-flip + delete-read-only ---------------------
  describe('Inbox messages - constrained owner mutations');
  await seed(async (db) => {
    await setDoc(doc(db, 'libraryUsers/licensed@example.com/messages/M_unread'), {
      text: 'hi', read: false,
    });
    await setDoc(doc(db, 'libraryUsers/licensed@example.com/messages/M_read'), {
      text: 'hi', read: true,
    });
  });
  await it('the owner may flip an unread message to read', async () => {
    await assertSucceeds(
      updateDoc(doc(patron('licensed@example.com'), 'libraryUsers/licensed@example.com/messages/M_unread'), {
        read: true,
      }),
    );
  });
  await it('the owner may NOT edit message content', async () => {
    await assertFails(
      updateDoc(doc(patron('licensed@example.com'), 'libraryUsers/licensed@example.com/messages/M_read'), {
        text: 'tampered',
      }),
    );
  });
  await it('the owner may delete a READ message but not an UNREAD one', async () => {
    await assertFails(
      deleteDoc(doc(patron('licensed@example.com'), 'libraryUsers/licensed@example.com/messages/M_unread2')),
    );
    // seed a fresh unread to be sure delete is denied on unread
    await seed(async (db) =>
      setDoc(doc(db, 'libraryUsers/licensed@example.com/messages/M_unread2'), { text: 'x', read: false }),
    );
    await assertFails(
      deleteDoc(doc(patron('licensed@example.com'), 'libraryUsers/licensed@example.com/messages/M_unread2')),
    );
    await assertSucceeds(
      deleteDoc(doc(patron('licensed@example.com'), 'libraryUsers/licensed@example.com/messages/M_read')),
    );
  });

  // ---- Discussion group content: membership gating ----------------------
  describe('Discussion groups - membership-gated content + DM push-hole');
  await seed(async (db) => {
    await setDoc(doc(db, 'discussionGroups/G1'), {
      creatorEmail: 'leader@example.com',
      status: 'open',
    });
    await setDoc(doc(db, 'discussionGroups/G1/members/member@example.com'), {
      email: 'member@example.com',
      status: 'approved',
    });
  });

  await it('an approved member may post a chat message as themselves', async () => {
    await assertSucceeds(
      setDoc(doc(patron('member@example.com'), 'discussionGroups/G1/chatMessages/c1'), {
        senderEmail: 'member@example.com',
        text: 'hello group',
      }),
    );
  });
  await it('a chat message over the 4000-char cap is rejected', async () => {
    await assertFails(
      setDoc(doc(patron('member@example.com'), 'discussionGroups/G1/chatMessages/c2'), {
        senderEmail: 'member@example.com',
        text: 'x'.repeat(4000),
      }),
    );
  });
  await it('a non-member may NOT read group chat (private pastoral content)', async () => {
    await assertFails(getDoc(doc(patron('outsider@example.com'), 'discussionGroups/G1/chatMessages/c1')));
  });
  await it('the group creator may open a 1:1 conversation with a member', async () => {
    await assertSucceeds(
      setDoc(doc(patron('leader@example.com'), 'discussionGroups/G1/conversations/member@example.com'), {
        lastMessageAt: 1,
      }),
    );
  });
  await it('a random patron may NOT open a conversation to push at an arbitrary user (the closed hole)', async () => {
    await assertFails(
      setDoc(doc(patron('attacker@example.com'), 'discussionGroups/G1/conversations/victim@example.com'), {
        lastMessageAt: 1,
      }),
    );
  });
  await it('a third party may NOT read a conversation they are not part of', async () => {
    await assertFails(
      getDoc(doc(patron('outsider@example.com'), 'discussionGroups/G1/conversations/member@example.com')),
    );
  });

  // ---- License / invite enumeration lockdown ----------------------------
  describe('groupLicenses / groupInvites - owner-scoped reads, no client writes');
  await seed(async (db) => {
    await setDoc(doc(db, 'groupLicenses/GL1'), {
      leaderEmail: 'leader@example.com',
      assignedToEmail: 'assignee@example.com',
    });
    await setDoc(doc(db, 'groupInvites/GI1'), {
      leaderEmail: 'leader@example.com',
      inviteeEmail: 'invitee@example.com',
      status: 'pending',
    });
  });
  await it('the leader may read their own group license; a stranger may not', async () => {
    await assertSucceeds(getDoc(doc(patron('leader@example.com'), 'groupLicenses/GL1')));
    await assertFails(getDoc(doc(patron('stranger@example.com'), 'groupLicenses/GL1')));
  });
  await it('no client may write a group license', async () => {
    await assertFails(
      setDoc(doc(patron('leader@example.com'), 'groupLicenses/GL2'), { leaderEmail: 'leader@example.com' }),
    );
  });
  await it('a stranger may NOT enumerate an invite (invitee email + status)', async () => {
    await assertFails(getDoc(doc(patron('stranger@example.com'), 'groupInvites/GI1')));
  });

  // ---- Coupons: no client enumeration -----------------------------------
  describe('coupons - no client read (discount-code enumeration closed)');
  await seed(async (db) => setDoc(doc(db, 'coupons/SAVE50'), { percent: 50 }));
  await it('a signed-in patron may NOT read a coupon', async () => {
    await assertFails(getDoc(doc(patron('licensed@example.com'), 'coupons/SAVE50')));
  });

  // ---- errorLogs: the pre-auth exception, tightly scoped ----------------
  describe('errorLogs - pre-auth failed-login logging, scoped');
  await it('an anonymous client may log a failed LOGIN attempt', async () => {
    await assertSucceeds(
      setDoc(doc(anon(), 'errorLogs/e1'), {
        message: 'bad password',
        location: 'login',
        app: 'reader',
        uid: null,
      }),
    );
  });
  await it('an anonymous client may NOT log from an arbitrary location (no spoofing app errors)', async () => {
    await assertFails(
      setDoc(doc(anon(), 'errorLogs/e2'), {
        message: 'x',
        location: 'dashboard',
        app: 'reader',
        uid: null,
      }),
    );
  });
  await it('a signed-in user may log their OWN error (self-attributed uid)', async () => {
    const uid = 'licensedexamplecom';
    await assertSucceeds(
      setDoc(doc(patron('licensed@example.com'), 'errorLogs/e3'), {
        message: 'boom',
        location: 'lesson-view',
        app: 'reader',
        uid,
      }),
    );
  });
  await it('a signed-in user may NOT forge an error under someone else\'s uid', async () => {
    await assertFails(
      setDoc(doc(patron('licensed@example.com'), 'errorLogs/e4'), {
        message: 'boom',
        location: 'lesson-view',
        app: 'reader',
        uid: 'someone-else',
      }),
    );
  });

  // ---- Summary ----------------------------------------------------------
  await testEnv.cleanup();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Rules tests: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log(`\nFailures:\n  - ${failures.join('\n  - ')}`);
  }
  console.log('='.repeat(60));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('\nHarness error:', e);
  process.exit(1);
});
