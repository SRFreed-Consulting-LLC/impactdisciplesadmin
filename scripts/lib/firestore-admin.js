// Shared Firebase Admin SDK bootstrap for the scripts/ tools (export.js,
// import.js, promote.js, fix-date-shapes.js). Reuses functions/'s own
// firebase-admin install (functions/node_modules/firebase-admin) rather than
// adding a second copy as a dependency of the Angular app itself - same
// pattern already used by this repo's ad-hoc migration scripts (see
// MIGRATION.md).
//
// Auth is Application Default Credentials (ADC) - run `gcloud auth
// application-default login` once locally (or set
// GOOGLE_APPLICATION_CREDENTIALS to a service account key) before using any
// of these scripts. Nothing here prompts for credentials itself.
//
// Resolution note: firebase-admin's subpath exports (e.g.
// "firebase-admin/firestore") only resolve correctly through Node's normal
// bare-specifier algorithm, which respects the package's `exports` map -
// require()'ing a hand-built relative path like
// "../../functions/node_modules/firebase-admin/firestore" does NOT go
// through that map and fails. require.resolve(..., {paths: [functionsDir]})
// resolves it as if this file lived in functions/, which does work.

const path = require("path");

const functionsDir = path.join(__dirname, "..", "..", "functions");
const admin = require(require.resolve("firebase-admin", {paths: [functionsDir]}));
const {getFirestore} = require(
  require.resolve("firebase-admin/firestore", {paths: [functionsDir]})
);

const KNOWN_PROJECTS = {
  dev: "impactdisciplesdev",
  impactdisciplesdev: "impactdisciplesdev",
  prod: "impactdisciples-a82a8",
  "impactdisciples-a82a8": "impactdisciples-a82a8",
};

/**
 * Resolves a --project=<value> CLI argument (accepts "dev"/"prod" shorthand
 * or a literal project id) to a real Firebase project id. Throws rather than
 * silently defaulting - there is no safe default between dev and prod.
 * @param {string} value Raw --project value.
 * @return {string} Resolved Firebase project id.
 */
function resolveProjectId(value) {
  if (!value) {
    throw new Error(
      "Missing --project=<dev|prod|projectId>. There is no default - " +
      "specify one explicitly."
    );
  }
  return KNOWN_PROJECTS[value] || value;
}

// One initializeApp() per distinct projectId+database per process - lets a
// script touch both dev and prod in the same run (e.g. promote.js) without
// Admin SDK's "app already exists" errors.
const dbByKey = new Map();

/**
 * Gets (initializing if needed) a Firestore instance for the given project.
 * @param {string} projectId Firebase project id (already resolved, not a
 * "dev"/"prod" shorthand).
 * @param {string} [databaseId] Named Firestore database, e.g.
 * "impactdiscipleship-books". Omit for the (default) database - which is
 * what every Web/Admin collection in scope for this tool lives in.
 * @return {import("firebase-admin").firestore.Firestore} Firestore client.
 */
function getFirestoreFor(projectId, databaseId) {
  const key = `${projectId}::${databaseId || "(default)"}`;
  if (!dbByKey.has(key)) {
    const app = admin.initializeApp(
      {credential: admin.credential.applicationDefault(), projectId},
      key
    );
    const db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);
    // Matches functions/src/index.ts's own setting - the Admin SDK throws on
    // any `undefined` field value by default (e.g. a customer record that
    // was never given a shippingAddress) rather than just omitting it. A
    // script building an update payload from a plain JS object with some
    // optional fields unset hits this constantly; without this, a batch
    // write can fail entirely partway through (see
    // backfill-customers-from-purchases.js's own history: this crashed a
    // live --execute run mid-batch on 2026-08-13).
    db.settings({ignoreUndefinedProperties: true});
    dbByKey.set(key, db);
  }
  return dbByKey.get(key);
}

module.exports = {admin, resolveProjectId, getFirestoreFor, KNOWN_PROJECTS};
