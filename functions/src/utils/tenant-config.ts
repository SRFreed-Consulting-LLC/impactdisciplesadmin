import {DocumentData, Firestore} from "firebase-admin/firestore";
import {tenantPath} from "../common/shared/lists/tenancy";

const CONFIG = tenantPath("config");

/**
 * The site's one `config` document, or undefined when there is none.
 *
 * Six functions read this collection (PayPal client id, free-shipping
 * threshold, ship-from address, lockout-alert recipients, the free ebook
 * link) and until 2026-09-05 each did it its own way: four took
 * `.limit(1)` and the first document back, two read the whole collection
 * and refused to continue if there was more than one. The second rule is
 * the right one everywhere - `config` is a singleton by convention, nothing
 * enforces it, and limit(1) returns an ARBITRARY document when there are
 * two, so a stray copy in production would mean charging against the wrong
 * PayPal app or shipping from the wrong address with no error anywhere.
 * Read the collection and refuse to guess.
 *
 * @param {Firestore} db Firestore.
 * @return {Promise<DocumentData | undefined>} The document's data, or
 * undefined when the collection is empty. Throws when there is more than
 * one document.
 */
export async function readTenantConfig(
  db: Firestore
): Promise<DocumentData | undefined> {
  const snap = await db.collection(CONFIG).get();
  if (snap.size > 1) {
    const ids = snap.docs.map((d) => d.id).join(", ");
    throw new Error(
      `Expected a single config document, found ${snap.size} (${ids}). ` +
      "Refusing to guess which one is live - remove the extras."
    );
  }
  return snap.docs[0]?.data();
}
