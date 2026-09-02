/**
 * Authorization decisions about a reader's own libraryUsers profile, kept as
 * pure functions so they can be tested without standing up a callable.
 *
 * These are the checks that decide who gets someone else's book content and
 * who may create things; an unnoticed change to one is the kind of bug that
 * does not announce itself.
 */

/** The fields these decisions read. Everything else on the profile is
 *  irrelevant here, and typing it loosely keeps this usable against a raw
 *  Firestore document. */
export interface AccessProfile {
  licensedBookIds?: unknown;
  internationalUser?: unknown;
  canLeadGroups?: unknown;
  revoked?: unknown;
}

/**
 * Whether this patron may READ a given book's content.
 *
 * Mirrors firestore.rules' canReadBook: staff carry the string "all" rather
 * than a list, and an international patron reads every book free of charge
 * (they are never asked to pay). Used by emailLessonPdf, which would otherwise
 * mail any lesson in the library to anyone holding an account.
 *
 * NOT the same rule as starting a group around a book - see
 * mayCreateGroupForBook, which deliberately refuses the staff bypass.
 *
 * @param {AccessProfile} profile The caller's own profile document.
 * @param {string} bookId The book being asked for.
 * @return {boolean} Whether the content may be sent.
 */
export function mayReadBook(profile: AccessProfile, bookId: string): boolean {
  const licensed = profile.licensedBookIds;
  if (licensed === "all") {
    return true;
  }
  if (profile.internationalUser === true) {
    return true;
  }
  return Array.isArray(licensed) && licensed.includes(bookId);
}

/**
 * Whether this patron may START an Impact Group around a given book.
 *
 * Same licence question as mayReadBook with ONE deliberate difference: there
 * is no staff bypass. That matches the pre-consolidation firestore.rules
 * create gate (hasBookLicense || isInternationalPatron), and the distinction
 * is intentional - reading someone's book as staff is routine, creating a
 * patron-facing group as staff is not.
 *
 * @param {AccessProfile} profile The caller's own profile document.
 * @param {string} bookId The book the group would study.
 * @return {boolean} Whether the group may be created.
 */
export function mayCreateGroupForBook(
  profile: AccessProfile,
  bookId: string
): boolean {
  const licensed = profile.licensedBookIds;
  const hasLicence = Array.isArray(licensed) && licensed.includes(bookId);
  return hasLicence || profile.internationalUser === true;
}

/**
 * Whether this patron may start Impact Groups at all.
 *
 * The intent is that only someone who has worked through all four Impact books
 * leads one. That data does not exist yet, so every account carries true.
 *
 * ABSENT MEANS ALLOWED - only an explicit false withholds it, so a profile
 * written before this field existed does not lose something it could do
 * yesterday. Never rewrite this as `=== true`.
 *
 * @param {AccessProfile} profile The caller's own profile document.
 * @return {boolean} Whether group creation is permitted.
 */
export function mayLeadGroups(profile: AccessProfile): boolean {
  return profile.canLeadGroups !== false;
}
