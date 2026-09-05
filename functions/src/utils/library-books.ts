import {Firestore, QueryDocumentSnapshot} from "firebase-admin/firestore";

/**
 * The library's `books` documents, wherever they are nested
 * (librarySeries/{seriesId}/books/{bookId}), as ONE collection-group read.
 *
 * A bare book id does not say which series it lives under, so every
 * caller that only has an id scans the group once and matches by doc id -
 * fine at this library's real scale (a handful of books). Six functions
 * each wrote that scan themselves until 2026-09-05; this is the one place
 * the bare collectionGroup("books") lives now.
 *
 * MULTI-TENANT NOTE. A collection-group query spans every `books`
 * subcollection in the database - which, once there is a second tenant
 * (the Capstone HQ direction), means every tenant's books. When that day
 * comes this is the single function to scope, rather than six.
 *
 * @param {Firestore} db Firestore.
 * @return {Promise<QueryDocumentSnapshot[]>} Every book document.
 */
export async function allBookDocs(
  db: Firestore
): Promise<QueryDocumentSnapshot[]> {
  return (await db.collectionGroup("books").get()).docs;
}

/**
 * The ids of every book that exists - for confirming a claimed book id
 * (a purchase's digitalBookId, an admin grant) before granting it, so a
 * stale id cannot be "granted" and silently do nothing forever.
 * @param {Firestore} db Firestore.
 * @return {Promise<Set<string>>} The known book ids.
 */
export async function knownBookIds(db: Firestore): Promise<Set<string>> {
  return new Set((await allBookDocs(db)).map((d) => d.id));
}

/**
 * One book's document by id, or undefined.
 * @param {Firestore} db Firestore.
 * @param {string} bookId The book's document id.
 * @return {Promise<QueryDocumentSnapshot | undefined>} The document.
 */
export async function findBookDoc(
  db: Firestore,
  bookId: string
): Promise<QueryDocumentSnapshot | undefined> {
  return (await allBookDocs(db)).find((d) => d.id === bookId);
}

/**
 * bookId -> title over the whole library, for labelling things that
 * reference a book by id (the public group finder).
 * @param {Firestore} db Firestore.
 * @return {Promise<Map<string, string>>} Titles by book id.
 */
export async function bookTitlesById(
  db: Firestore
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  for (const doc of await allBookDocs(db)) {
    const title = doc.data().title;
    if (typeof title === "string") {
      titles.set(doc.id, title);
    }
  }
  return titles;
}
