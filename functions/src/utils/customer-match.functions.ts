import {tenantPath} from "../common/shared/lists/tenancy";
const CUSTOMERS = tenantPath("customers");
// Shared by customer-upsert.functions.ts (purchases) and
// event-registration-customer-upsert.functions.ts (event registrations) -
// both compare an incoming record's name against a "customers" doc using
// the same normalization rules, so a person doesn't get flagged as a
// mismatch (or fail to match at all) over case, whitespace, or an accent
// mark. One definition so those two triggers can't quietly drift apart.

/**
 * Name comparison key - trim + lowercase + diacritics stripped, so
 * "Rick" vs "RICK", a stray trailing space, or "Hernandez" vs "Hernández"
 * don't read as a real disagreement. Only used to decide whether two values
 * differ; the raw, un-normalized value is always what actually gets stored.
 * @param {unknown} value Raw name value.
 * @return {string} Normalized comparison key ("" if not a real string).
 */
export function normalizedName(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  // NFD decomposes an accented character into base + combining diacritical
  // mark(s) - the \p{Diacritic} Unicode property escape then strips just
  // those marks, leaving the base letter (matches "Hernández" to
  // "Hernandez").
  const normalized = value.trim().toLowerCase().normalize("NFD");
  return normalized.replace(/\p{Diacritic}/gu, "");
}

/**
 * Digits-only phone comparison key, with a leading US country-code "1"
 * stripped either way - "1 678.223.5312", "(678) 223-5312", and
 * "6782235312" all normalize to the same 10 digits.
 * @param {string | null | undefined} value Raw phone number.
 * @return {string} Normalized digit string.
 */
export function normalizedPhoneDigits(value?: string | null): string {
  const digits = (value ?? "").replace(/\D/g, "");
  const hasCountryCode = digits.length === 11 && digits.startsWith("1");
  return hasCountryCode ? digits.slice(1) : digits;
}

/**
 * Deliberately loose "is this even shaped like an email" check - not full
 * RFC validation, just enough to reject obvious garbage (a bare "x", a
 * name with no "@" at all) before it creates a customer record. Live-
 * diagnosed 2026-08-13: a purchase with email "x" (clearly placeholder/
 * test data, not a real address) created a customer doc keyed on that
 * non-email, matched against nothing else and useless for lookup.
 * @param {unknown} rawValue Candidate email address.
 * @return {boolean} Whether it's plausibly a real email address.
 */
export function isPlausibleEmail(rawValue: unknown): boolean {
  if (typeof rawValue !== "string") {
    return false;
  }
  const value = rawValue.trim();
  const at = value.indexOf("@");
  return at > 0 && at < value.length - 1 && value.includes(".", at);
}

/**
 * Finds the customer for an already-normalized email, creating one
 * atomically when none exists.
 *
 * The lookup and the create MUST share a transaction. Both callers are
 * onDocumentCreated triggers, so two records saved by the same NEW address
 * in quick succession - two orders, or an order and a registration - each
 * observe an empty result and each create their own customer. Confirmed in
 * prod on 2026-08-27: a duplicate pair identical in every field except
 * newsletterSubscribedDate, 183 milliseconds apart.
 *
 * The transaction body is deliberately pure - only tx.get and tx.create -
 * because Firestore retries it on contention. Tag rules are applied by the
 * CALLER, outside the transaction: applyTagRulesForActivity does its own
 * writes, and tag_applications is keyed {email}__{tag}, so it is already
 * idempotent if both racers reach it.
 *
 * `role`, `notes`, `pendingChanges` and `tags` are seeded here rather than
 * by each caller so a new customer cannot be created in two different
 * shapes depending on which trigger happened to win.
 * @param {FirebaseFirestore.Firestore} db Firestore instance.
 * @param {string} email Normalized (trimmed, lowercased) address.
 * @param {Record<string, unknown>} seed Caller-specific fields for a
 *   brand-new record; ignored when one already exists.
 * @return {Promise<object>} The customer ref, its data, and whether THIS
 *   call is the one that created it.
 */
export async function findOrCreateCustomer(
  db: FirebaseFirestore.Firestore,
  email: string,
  seed: Record<string, unknown>
): Promise<{
  ref: FirebaseFirestore.DocumentReference;
  created: boolean;
  data: FirebaseFirestore.DocumentData;
}> {
  const matching = db.collection(CUSTOMERS)
    .where("email", "==", email)
    .limit(1);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(matching);
    if (!snap.empty) {
      const doc = snap.docs[0];
      return {ref: doc.ref, created: false, data: doc.data()};
    }
    const ref = db.collection(CUSTOMERS).doc();
    const data = {
      ...seed,
      email,
      role: "Customer",
      notes: [],
      pendingChanges: [],
      tags: [],
    };
    tx.create(ref, data);
    return {ref, created: true, data};
  });
}
