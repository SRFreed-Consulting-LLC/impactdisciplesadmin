import {tenantPath, triggerPath} from "./common/shared/lists/tenancy";
const LIBRARY_USERS = tenantPath("libraryUsers");
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {logger} from "firebase-functions";
import {isPlausibleEmail} from "./utils/customer-match.functions";
import {applyStorePurchaseGrant} from "./library-store-license-grant";
import {knownBookIds} from "./utils/library-books";
import {getFirestore} from "firebase-admin/firestore";

// Grants Impact Discipleship Library book licenses for digital books bought
// through this project's store, directly from this purchases trigger.
//
// History (Phase 4 of the consolidation plan): this used to be an HTTP
// call to a `grantStorePurchaseLicenses` endpoint authenticated by a
// LIBRARY_GRANT_SECRET shared secret, because the library's data lived in
// a different Firebase project's named database that only the (now
// retired) manager app's functions had Admin SDK access to. After the
// library migrated into THIS project's own default database - and every
// library function into this same codebase - the bridge had become this
// codebase HTTP-calling itself through a public endpoint. Collapsed
// 2026-08-17: the trigger now runs the same applyStorePurchaseGrant
// transaction in-process; the endpoint and the secret are retired.
//
// Why a purchases trigger rather than the web client: it covers the Stripe
// and PayPal checkout paths at once (both land in `purchases`), it can't
// be forged from a browser, and it keeps working once firestore.rules
// stops trusting client writes at all.
//
// The product -> library book mapping needs no new lookup: `products` docs
// carry `digitalBookId`, copied onto each CartItem at checkout, so the
// purchase doc alone is enough.
//
// NOTE: license *terms* are still not enforced anywhere - every license is
// perpetual in practice. Deliberately unchanged here - an open product
// decision, not something to quietly settle inside a grant call.

const libraryDb = getFirestore();

interface DigitalCartItem {
  isDigitalBook?: boolean;
  digitalBookId?: string;
  language?: string;
}

interface BookGrant {
  bookId: string;
  language?: string;
}

/**
 * The distinct digital-book grants a purchase's cart implies. Items without
 * `digitalBookId` are dropped rather than reported: a digital-book product
 * that was never linked to a library book can't grant access to anything,
 * and the reader's own store already hides such products from sale for the
 * same reason.
 * @param {DigitalCartItem[] | undefined} cartItems The purchase's cartItems.
 * @return {BookGrant[]} One entry per distinct book id, first occurrence
 * wins.
 */
export function digitalBookGrants(
  cartItems: DigitalCartItem[] | undefined
): BookGrant[] {
  if (!Array.isArray(cartItems)) {
    return [];
  }
  const byBookId = new Map<string, BookGrant>();
  for (const item of cartItems) {
    if (item?.isDigitalBook !== true) {
      continue;
    }
    const bookId =
      typeof item.digitalBookId === "string" ? item.digitalBookId.trim() : "";
    if (!bookId || byBookId.has(bookId)) {
      continue;
    }
    // Omit `language` entirely when absent rather than including it as
    // undefined - it's written straight into a bookLicenses entry, and
    // Firestore rejects a write with any explicitly-undefined field.
    byBookId.set(bookId, {
      bookId,
      ...(item.language ? {language: item.language} : {}),
    });
  }
  return [...byBookId.values()];
}

// `retry: true` because a dropped grant means a paying customer with no
// access, and the grant is idempotent on (purchaseId, bookId) - a replay
// re-grants nothing. A persistent failure retries for up to 7 days rather
// than failing once quietly - the right direction for money-affecting
// work; check this function's logs first if the library is refusing
// access after a sale.
export const onPurchaseGrantLibraryLicenses = onDocumentCreated(
  {
    document: triggerPath("purchases", "{id}"),
    retry: true,
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) {
      return;
    }

    const grants = digitalBookGrants(data.cartItems);
    if (grants.length === 0) {
      // Overwhelmingly the common case - most purchases are physical or
      // event items. Return before touching email validation.
      return;
    }

    const email = typeof data.email === "string" ?
      data.email.trim().toLowerCase() : "";
    if (!isPlausibleEmail(email)) {
      // No usable identity to attach the license to. `libraryUsers` is
      // keyed by email, so there is nothing to retry into - log and stop
      // rather than burning the retry window on a purchase that can never
      // resolve itself. Needs a manual grant via grantLibraryUserLicenses.
      logger.error(
        "Digital books purchased but the purchase has no usable email - " +
        "library licenses NOT granted, needs a manual grant",
        {purchaseId: event.params.id, books: grants.map((g) => g.bookId)}
      );
      return;
    }

    // Confirm every claimed book actually exists, so a stale digitalBookId
    // can't be "granted" and silently do nothing forever (knownBookIds:
    // one books collection-group scan, matched by doc id).
    const bookIds = await knownBookIds(libraryDb);
    const known = grants.filter((g) => bookIds.has(g.bookId));
    const unknown = grants
      .filter((g) => !bookIds.has(g.bookId))
      .map((g) => g.bookId);
    if (unknown.length > 0) {
      // A data problem no retry fixes - log it for an admin and grant
      // whatever IS resolvable rather than failing the whole purchase.
      logger.error("Store purchase referenced unknown book ids", {
        purchaseId: event.params.id,
        email,
        unknown,
      });
    }
    if (known.length === 0) {
      return;
    }

    const recipientRef = libraryDb.collection(LIBRARY_USERS).doc(email);
    const now = Date.now();
    let result = {granted: [] as string[], skipped: [] as string[]};
    await libraryDb.runTransaction(async (transaction) => {
      const snap = await transaction.get(recipientRef);
      result = applyStorePurchaseGrant({
        transaction,
        recipientRef,
        recipientSnap: snap,
        recipientEmail: email,
        books: known,
        purchaseId: event.params.id,
        now,
      });
    });

    logger.info("Granted library licenses for store purchase", {
      purchaseId: event.params.id,
      email,
      granted: result.granted,
      skipped: result.skipped,
      ...(unknown.length > 0 ? {unknown} : {}),
    });
  }
);
