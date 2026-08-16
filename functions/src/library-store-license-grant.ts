import {
  Transaction,
  DocumentReference,
  DocumentSnapshot,
} from "firebase-admin/firestore";

export interface StoreBookGrant {
  bookId: string;
  language?: string;
}

export interface ApplyStorePurchaseGrantParams {
  transaction: Transaction;
  recipientRef: DocumentReference;
  recipientSnap: DocumentSnapshot;
  recipientEmail: string;
  books: StoreBookGrant[];
  purchaseId: string;
  now: number;
}

export interface StorePurchaseGrantResult {
  granted: string[];
  /** Books this exact purchase had already granted - a replayed delivery. */
  skipped: string[];
}

/**
 * Ported verbatim from impact-discipleship-library-manager-new's
 * store-license-grant.ts. Grants book licenses bought through
 * impactdisciples-web's store into the buyer's own `libraryUsers/{email}`
 * doc. Sibling of applyLicenseGrant (group licenses) and the inline merge
 * in grantLibraryUserLicenses (admin grants) - a third provenance for the
 * same two fields, kept here rather than inlined so the
 * bookLicenses/licensedBookIds merge stays comparable across all three.
 *
 * Called by the grantStorePurchaseLicenses endpoint, which the store
 * project's own `onPurchaseGrantLibraryLicenses` purchases trigger
 * invokes (see library-license-grant.functions.ts, this app's own caller
 * of that endpoint).
 *
 * Like applyLicenseGrant, deliberately never writes `userId`: the buyer
 * may have no reader account yet, and that field must only ever hold the
 * RECIPIENT's own Auth uid.
 *
 * Idempotent on (purchaseId, bookId) - the caller retries on failure, and
 * a replayed delivery must not stack duplicate entries. A book already
 * licensed from a DIFFERENT source (an admin grant, a group license, an
 * earlier purchase) still gets its own entry here: each provenance is
 * revoked independently, so dropping this one would let an unrelated
 * revocation take away access this purchase paid for.
 * @param {ApplyStorePurchaseGrantParams} params Transaction, recipient, books.
 * @return {StorePurchaseGrantResult} Which book ids were granted vs. replayed.
 */
export function applyStorePurchaseGrant(
  params: ApplyStorePurchaseGrantParams
): StorePurchaseGrantResult {
  const {
    transaction,
    recipientRef,
    recipientSnap,
    recipientEmail,
    books,
    purchaseId,
    now,
  } = params;

  const existing = recipientSnap.exists ?
    (recipientSnap.data() as {
        bookLicenses?: Record<string, unknown>[];
        licensedBookIds?: string[];
        createdAt?: number;
      }) :
    undefined;

  // Array.isArray guards: legacy docs can carry the 'all' string sentinel
  // in licensedBookIds - spreading a string would explode it into
  // characters. Same guard grantLibraryUserLicenses uses.
  const bookLicenses = Array.isArray(existing?.bookLicenses) ?
    [...existing.bookLicenses] :
    [];
  const priorIds = Array.isArray(existing?.licensedBookIds) ?
    existing.licensedBookIds :
    [];

  const granted: string[] = [];
  const skipped: string[] = [];

  for (const book of books) {
    const alreadyFromThisPurchase = bookLicenses.some(
      (license) =>
        license["bookId"] === book.bookId &&
        license["storePurchaseId"] === purchaseId
    );
    if (alreadyFromThisPurchase) {
      skipped.push(book.bookId);
      continue;
    }
    // `language` omitted entirely when absent rather than written as
    // undefined - Firestore rejects a write carrying an explicitly-
    // undefined field, even nested inside an array element.
    bookLicenses.push({
      bookId: book.bookId,
      purchaseDate: now,
      source: "store-purchase",
      storePurchaseId: purchaseId,
      ...(book.language ? {language: book.language} : {}),
    });
    granted.push(book.bookId);
  }

  if (granted.length === 0) {
    return {granted, skipped};
  }

  const licensedBookIds = Array.from(new Set([...priorIds, ...granted]));

  transaction.set(
    recipientRef,
    {
      email: recipientEmail,
      bookLicenses,
      licensedBookIds,
      updatedAt: now,
      ...(recipientSnap.exists ? {} : {createdAt: now}),
    },
    {merge: true}
  );

  return {granted, skipped};
}
