// DID THE TRIGGER ACTUALLY FIRE?
//
//   npm run emu          (in one terminal)
//   npm run test:integration
//
// THE ONE FAILURE MODE NOTHING ELSE IN THIS REPO CATCHES. A Firestore
// trigger names its collection as a hardcoded string literal -
// `onDocumentCreated("purchases/{id}", ...)`. When the document those
// triggers watch moves - which is exactly what the tenant migration does,
// collection by collection - a trigger whose literal was not updated simply
// never runs. Firestore does not error. The deploy succeeds. The logs are
// empty because nothing executed. A purchase is written, looks completely
// normal, and is never fulfilled, never upserted onto a customer, never
// grants the library licence somebody paid for.
//
// Every other bypass of the tenancy seam fails LOUDLY: a read returns an
// empty list and a screen is visibly wrong within a minute. Only triggers
// are silent, and silence is why they get their own suite.
//
// WHAT MAKES THIS A MIGRATION TEST RATHER THAN A UNIT TEST: every write below
// goes through `tenantPath()`, the same seam the production code uses. So the
// day `purchases` is added to TENANT_COLLECTIONS, these tests start writing
// to `tenants/impactdisciples.com/purchases` on their own - and if the
// trigger's own literal was not moved with it, they go red. That is the whole
// point. Do not "simplify" these to string literals; a test that hardcodes
// the old path passes forever and proves nothing.
//
// NOT COVERED HERE, said plainly rather than left to be assumed:
//   - the five discussionGroups subcollection notification triggers, which
//     need FCM tokens and a seeded conversation
//   - onTranslationWritten, whose path is five levels deep and needs a whole
//     librarySeries/books/units/lessons fixture
// Both still need liveness cover before their collections move.

const test = require("node:test");
const assert = require("node:assert");

const {
  preflight, getDb, getApp, getAuth, reseed, waitFor,
} = require("./helpers/emulator");
const {tenantPath} = require("../scripts/lib/tenancy");

const db = () => getDb();

/** A value nothing else in the fixture world can collide with. */
let seq = 0;
const uniq = (prefix) => `${prefix}-liveness-${process.pid}-${++seq}`;

/**
 * Waits for a document to satisfy a predicate, then returns it.
 *
 * Triggers are asynchronous by nature - the write returns long before the
 * function runs - so every assertion here is "eventually", never "now".
 * A generous timeout costs nothing on a pass and is the difference between
 * a real failure and a flake on a cold function instance.
 *
 * @param {object} ref A DocumentReference.
 * @param {Function} predicate Called with the document's data.
 * @param {string} label What we are waiting for, used in the failure.
 * @return {Promise<object>} The document's data once it satisfies.
 */
async function eventually(ref, predicate, label) {
  let last;
  await waitFor(async () => {
    const snap = await ref.get();
    last = snap.exists ? snap.data() : undefined;
    return !!last && predicate(last);
  }, {timeoutMs: 45000, intervalMs: 500, label});
  return last;
}

test("trigger liveness", {concurrency: false}, async (t) => {
  await preflight();
  reseed();

  await t.test("purchases: the create triggers all fire", async () => {
    const email = `${uniq("buyer")}@example.com`;
    const ref = db().collection(tenantPath("purchases")).doc();

    await ref.set({
      email,
      firstName: "Liveness",
      lastName: "Probe",
      total: 25,
      orderDate: new Date(),
      cartItems: [{
        id: "prod-liveness",
        name: "A physical thing",
        cost: 25,
        quantity: 1,
        isPhysical: true,
      }],
    });

    // 1. onPurchaseFulfillmentEligible - stamps the purchase itself.
    const fulfilled = await eventually(ref,
      (d) => !!d.fulfillmentStatus,
      "onPurchaseFulfillmentEligible to stamp fulfillmentStatus");
    assert.ok(["new", "closed"].includes(fulfilled.fulfillmentStatus),
      `unexpected fulfillmentStatus: ${fulfilled.fulfillmentStatus}`);
    assert.ok(Array.isArray(fulfilled.statusHistory) &&
      fulfilled.statusHistory.length > 0,
    "the first statusHistory entry must land with the status");

    // 2. onPurchaseCreated (new-record alerts) - stamps the doc AND counts.
    await eventually(ref,
      (d) => d.newRecordStatus === "new",
      "onPurchaseCreated to stamp newRecordStatus");

    // 3. onPurchaseCustomerUpsert - creates the customer from the purchase.
    await waitFor(async () => {
      const found = await db().collection(tenantPath("customers"))
        .where("email", "==", email).limit(1).get();
      return !found.empty;
    }, {timeoutMs: 45000, intervalMs: 500,
      label: "onPurchaseCustomerUpsert to create the customer"});
  });

  await t.test("purchases: the alert counter actually increments", async () => {
    // Deliberately separate from the stamp above. The two are different
    // writes to different documents inside one trigger, and a path change
    // could plausibly break the aggregate while leaving the doc stamp
    // working (or the reverse).
    const counts = db().doc("meta/newRecordCounts");
    const before = (await counts.get()).data()?.purchases || 0;

    await db().collection(tenantPath("purchases")).doc().set({
      email: `${uniq("counter")}@example.com`,
      total: 10,
      orderDate: new Date(),
      cartItems: [{id: "p", name: "thing", cost: 10, quantity: 1}],
    });

    await eventually(counts,
      (d) => (d.purchases || 0) > before,
      `meta/newRecordCounts.purchases to rise above ${before}`);
  });

  await t.test("event-registrations: the create triggers fire", async () => {
    const email = `${uniq("registrant")}@example.com`;
    const ref = db().collection(tenantPath("event-registrations")).doc();

    await ref.set({
      email,
      firstName: "Liveness",
      lastName: "Probe",
      eventId: "event-summit-2027",
      registrationDate: new Date(),
    });

    await eventually(ref,
      (d) => d.newRecordStatus === "new",
      "onEventRegistrationCreated to stamp newRecordStatus");

    await waitFor(async () => {
      const found = await db().collection(tenantPath("customers"))
        .where("email", "==", email).limit(1).get();
      return !found.empty;
    }, {timeoutMs: 45000, intervalMs: 500,
      label: "onEventRegistrationCustomerUpsert to create the customer"});
  });

  await t.test("discussionGroups: the delete trigger fires", async () => {
    // onGroupDeletedCleanup is the only onDocumentDeleted trigger in the
    // repo, and deletion is the one event you cannot retry your way out of -
    // if it silently stops running, group licences are stranded assigned to
    // a group that no longer exists and nothing says so.
    const groupRef = db().collection(tenantPath("discussionGroups")).doc();
    const licenceRef = db().collection(tenantPath("groupLicenses")).doc();

    await groupRef.set({
      title: uniq("group"),
      creatorEmail: "patron@test.local",
      status: "open",
      bookId: "book-liveness",
    });
    await licenceRef.set({
      // `status: "assigned"` is load-bearing, not decoration -
      // shouldDetachLicense() requires it, and a licence without it is
      // deliberately left alone. Getting this wrong is how this test first
      // went red, which is a fair sign it is asserting something real.
      status: "assigned",
      assignedGroupId: groupRef.id,
      recipientEmail: "patron@test.local",
      bookId: "book-liveness",
    });

    await groupRef.delete();

    await eventually(licenceRef,
      (d) => d.assignedGroupDeleted === true,
      "onGroupDeletedCleanup to flag the stranded licence");
  });

  await t.test("admin_users: the role-claim trigger fires", async () => {
    // The claim sync is what firestore.rules depends on for EVERY staff
    // write in the system - rules cannot read admin_users, only the token.
    // If this trigger stops firing, a new staff account silently has no
    // permissions anywhere and it reads as a login problem.
    const email = `${uniq("staff")}@example.com`;
    const user = await getAuth(getApp()).createUser({
      email, password: "test-password-1",
    });

    await db().collection(tenantPath("admin_users")).doc().set({
      email, firstName: "Liveness", lastName: "Probe",
      role: "Employee", firebaseUID: user.uid,
    });

    await waitFor(async () => {
      const fresh = await getAuth(getApp()).getUser(user.uid);
      return (fresh.customClaims || {}).role === "Employee";
    }, {timeoutMs: 45000, intervalMs: 500,
      label: "onAdminUserRoleSync to set the role custom claim"});
  });
});
