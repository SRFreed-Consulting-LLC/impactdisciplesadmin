// A reader-app library user's `libraryUsers` profile, as this app's Library
// section needs it - a trimmed view of the reader app's own LibraryUser
// model (impact-discipleship-library-new's core/models/user.model.ts is the
// authoritative shape; field names must stay in sync), ported from
// impact-discipleship-library-manager-new's core/services/library-user.service.ts.
// This collection lives in the named 'impactdiscipleship-books' database and
// is owned/written by the reader app - reads are direct here, but every
// admin WRITE must go through the source app's Library Users Cloud
// Functions (updateLibraryUser/setLibraryUserRevoked/etc. - see that app's
// CLAUDE.md), not a direct client write (firestore.rules scopes
// `libraryUsers` writes to the owner's own email).

/** One entry in a library user's `bookLicenses` provenance array. `source`
 *  is 'store-purchase' for store checkouts (web storefront + reader
 *  store, both stamped by applyStorePurchaseGrant with the purchase doc
 *  id), 'group-license' for group assignments, 'admin-grant' for licenses
 *  comped by staff, and absent only on legacy pre-consolidation entries.
 *  admin-grant and store-purchase entries are removable from the Library
 *  Users screen (store removals via revokeStorePurchasedLicense - no
 *  refund attached); group licenses are managed from their group; the
 *  refund path (refundStorePurchase) strips store-purchase entries
 *  itself when the admin asks it to. */
export interface LibraryUserBookLicense {
  bookId: string;
  purchaseDate?: number;
  source?: 'group-license' | 'admin-grant' | 'store-purchase';
  groupLicenseId?: string;
  storePurchaseId?: string;
  grantedBy?: string;
  language?: string;
  type?: string;
}

export interface LibraryUser {
  /** Doc id == lowercased email (not a Firebase Auth uid). */
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  lastLogin?: number;
  createdAt?: number;
  updatedAt?: number;
  /** The user's own Auth uid, stamped by the reader's recordLogin - absent
   *  for legacy-import docs whose owner has never signed in. */
  userId?: string;
  legacyImport?: boolean;
  /** IP-derived location from the user's most recent sign-in - written by
   *  the reader app's GeoLocationService/recordLogin, same source the World
   *  Map plots. */
  location?: {
    lat: number;
    lng: number;
    city?: string;
    region?: string;
    country?: string;
    countryCode?: string;
    updatedAt: number;
  };
  /** Sticky "has ever signed in from outside the US" marker - grants free
   *  all-book access in the reader app. Reader-owned; re-set to true on the
   *  user's next non-US login regardless of any admin edit. */
  internationalUser?: boolean;
  /** Flat licensed-book id list ('all' is the legacy staff-bypass value). */
  licensedBookIds?: string[] | 'all';
  bookLicenses?: LibraryUserBookLicense[];
  /** Reader-owned personal preferences - read-only here. */
  preferredLanguage?: string;
  notificationsEnabled?: boolean;
  /** Admin-set access revocation - the Auth account is disabled alongside;
   *  reversible. */
  revoked?: boolean;
  revokedAt?: number;
  revokedBy?: string;
}
