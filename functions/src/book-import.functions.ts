import {onCall, HttpsError} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import {requireAdminRole} from "./admin-users.functions";
import {runBookImport} from "./book-import/importer";
import {BookImportRequest} from "./book-import/types";

// AI Book Import - self-serve PDF-to-curriculum parsing for the Library
// section, ported from impact-discipleship-library-manager-new's own
// importBookFromPdf (functions/src/index.ts + functions/src/book-import/) as
// a self-contained copy in this app's own Cloud Functions, per the
// consolidation plan's explicit decision: give admin its own copy rather
// than call the manager app's still-running function, since that app (and
// its whole Firebase project) is going away once this migration finishes -
// nothing here should depend on it still existing.
//
// This callable only PARSES; it never writes library content. All Firestore
// writes happen client-side (see LibraryImportBookService), gated by the
// same rules any Library content write is - so this adds no new Firestore
// rules surface, same as the source app's version.
//
// Needs the ANTHROPIC_API_KEY secret set for THIS project before it can run
// - `firebase functions:secrets:set ANTHROPIC_API_KEY` (a separate secret
// from the manager app's own copy of the same name; each Cloud Functions
// deployment has its own secret store, even sharing a Firestore project
// doesn't share secrets). Model id is overridable with the
// BOOK_IMPORT_MODEL env/param (default claude-sonnet-4-5).
const anthropicSecret = defineSecret("ANTHROPIC_API_KEY");

export const importBookFromPdf = onCall(
  {secrets: [anthropicSecret], timeoutSeconds: 540, memory: "1GiB"},
  async (request) => {
    await requireAdminRole(request.auth?.uid);
    const apiKey = anthropicSecret.value();
    if (!apiKey) {
      throw new HttpsError(
        "failed-precondition",
        "ANTHROPIC_API_KEY secret is not set for this project."
      );
    }
    return runBookImport(apiKey, (request.data ?? {}) as BookImportRequest);
  }
);
