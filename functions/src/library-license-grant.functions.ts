import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {logger} from "firebase-functions";
import {isPlausibleEmail} from "./utils/customer-match.functions";

// Grants Impact Discipleship Library book licenses for digital books bought
// through this project's store, by calling the library's own
// `grantStorePurchaseLicenses` endpoint (see
// impact-discipleship-library-manager-new/functions/src/index.ts).
//
// Why this exists: until now a digital-book purchase here wrote its licenses
// to this project's `impact-users` collection, which the reader app does not
// read. The reader gates content on `libraryUsers/{email}.licensedBookIds` in
// the *named* `impactdiscipleship-books` database of its OWN project, so a
// store purchase granted nothing - someone paid and got no access. See the
// Firestore lockdown plan's finding H3.
//
// Why the grant is an HTTP call rather than a direct write: the target lives
// in a different Firebase project AND a non-default database. The manager
// repo's functions already hold Admin SDK credentials for it and already
// implement this exact bookLicenses/licensedBookIds merge for group and admin
// grants, so the write belongs there - reaching across with a second
// service-account key would duplicate that logic and the credential. It also
// survives the planned cutover of library data to impactdisciples-a82a8: the
// endpoint moves with its data, only LIBRARY_GRANT_URL changes.
//
// Why a purchases trigger rather than the web client: it covers the Stripe and
// PayPal checkout paths at once (both land in `purchases`), it can't be forged
// from a browser, and it keeps working once firestore.rules stops trusting
// client writes at all.
//
// The product -> library book mapping needs no new lookup: legacy `products`
// docs already carry `digitalBookId`, pointing at the reader project's own
// book id, and the reader's own store grants off exactly that field. It is
// copied onto each CartItem at checkout, so the purchase doc alone is enough.
//
// NOTE: license *terms* are not enforced anywhere. This project writes
// `type: 'year', length: 1` onto its own impact-users licenses, but the reader
// checks plain membership in the flat `licensedBookIds` array with no date
// comparison, so every license is perpetual in practice. Deliberately not
// changed here - it is an open product decision, not something to quietly
// settle inside a grant call.

/**
 * The library's grant endpoint. Defaults to the reader app's current project
 * (impactdisciplesdev), which hosts the library data for BOTH this project's
 * dev and prod deploys today - the reader has only one live environment. Set
 * LIBRARY_GRANT_URL in functions/.env to repoint it after the planned move of
 * library data to impactdisciples-a82a8.
 */
const GRANT_URL = process.env.LIBRARY_GRANT_URL ||
  "https://us-central1-impactdisciplesdev.cloudfunctions.net" +
  "/grantStorePurchaseLicenses";

/** Shared secret, matched against the endpoint's own copy. */
const GRANT_SECRET_NAME = "LIBRARY_GRANT_SECRET";

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
 * that was never linked to a library book can't grant access to anything, and
 * the reader's own store already hides such products from sale for the same
 * reason.
 * @param {DigitalCartItem[] | undefined} cartItems The purchase's cartItems.
 * @return {BookGrant[]} One entry per distinct book id, first occurrence wins.
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
    // Omit `language` entirely when absent rather than sending it as
    // undefined - the receiving end writes it straight into a bookLicenses
    // entry, and Firestore rejects a write with any explicitly-undefined
    // field, however deeply nested.
    byBookId.set(bookId, {
      bookId,
      ...(item.language ? {language: item.language} : {}),
    });
  }
  return [...byBookId.values()];
}

// `retry: true` because a dropped grant means a paying customer with no
// access, and the endpoint is idempotent on (purchaseId, bookId) - a replay
// re-grants nothing. The tradeoff accepted knowingly: a persistent failure
// (bad secret, endpoint down) retries for up to 7 days rather than failing
// once quietly. That is the right direction for money-affecting work, but it
// does mean a misconfiguration shows up as sustained error volume - check
// this function's logs first if the library is refusing access after a sale.
export const onPurchaseGrantLibraryLicenses = onDocumentCreated(
  {
    document: "purchases/{id}",
    secrets: [GRANT_SECRET_NAME],
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
      // event items. Return before touching email validation or the network.
      return;
    }

    const email = typeof data.email === "string" ?
      data.email.trim().toLowerCase() : "";
    if (!isPlausibleEmail(email)) {
      // No usable identity to attach the license to. `libraryUsers` is keyed
      // by email, so there is nothing to retry into - log and stop rather
      // than burning the retry window on a purchase that can never resolve
      // itself. Needs a manual grant via the library manager's own
      // grantLibraryUserLicenses.
      logger.error(
        "Digital books purchased but the purchase has no usable email - " +
        "library licenses NOT granted, needs a manual grant",
        {purchaseId: event.params.id, books: grants.map((g) => g.bookId)}
      );
      return;
    }

    const secret = process.env[GRANT_SECRET_NAME] ?? "";
    if (!secret) {
      throw new Error(
        `${GRANT_SECRET_NAME} is not set - cannot grant library licenses`
      );
    }

    const response = await fetch(GRANT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-library-grant-secret": secret,
      },
      body: JSON.stringify({
        email,
        purchaseId: event.params.id,
        books: grants,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      // Thrown, not swallowed: with retry: true this is what buys the
      // endpoint another attempt after a transient failure.
      throw new Error(
        `Library license grant failed (${response.status}) for purchase ` +
        `${event.params.id}: ${body.slice(0, 500)}`
      );
    }

    const result = await response.json().catch(() => ({}));
    logger.info("Granted library licenses for store purchase", {
      purchaseId: event.params.id,
      email,
      granted: result?.granted ?? [],
      skipped: result?.skipped ?? [],
    });
  }
);
