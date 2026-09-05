// A reader-app library user's `libraryUsers` profile. THE type lives in the
// shared submodule since 2026-09-05 (@impact-common/models/library-user.
// model) - this file re-exports it so the Library section's nine importers
// keep their path. It used to hold a hand-synced copy that had drifted from
// the reader's (no theme, canLeadGroups or legacyId fields here; no `type`
// on a licence entry there; different opinions on which fields are
// required).
//
// Reads are direct here, but every admin WRITE must go through this repo's
// Library Users Cloud Functions (updateLibraryUser/setLibraryUserRevoked/
// grantLibraryUserLicenses/etc.), not a direct client write (firestore.rules
// scopes `libraryUsers` writes to the owner's own email).
export type {
  LibraryUser,
  LibraryUserBookLicense,
  LibraryUserLocation,
} from '@impact-common/models/library-user.model';
