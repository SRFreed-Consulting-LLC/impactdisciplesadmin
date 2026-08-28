import {Timestamp} from "firebase-admin/firestore";
import {
  normalizedName,
  normalizedPhoneDigits,
} from "./customer-match.functions";

// The "fill it in, or queue it for a human" rule that both customer-upsert
// triggers apply to a customer record.
//
// It existed as two implementations (2026-08-27 sweep, P6): the purchase
// trigger's and the event-registration trigger's, whose own header already
// conceded "Otherwise identical rules". Both files ALREADY imported
// findOrCreateCustomer, isPlausibleEmail and normalizedName from
// customer-match.functions - the shared home existed and was in use; only the
// reconciliation was left behind.
//
// Why two copies was worse here than usual: this is the WRITE PATH for the
// "Pending Updates" queue an admin resolves in CustomerDialogComponent, so
// the two triggers have to agree on the entry shape AND on when a difference
// is a real disagreement versus a fill-in - and that agreement was enforced
// only by two independent implementations happening to match. The purchase
// copy already records a live bug fixed once in it alone: a junk phone value
// that normalizes to "" looked identical to "nothing on file", so a blank
// field was "filled" with the same junk on every future purchase forever -
// "two 2026-08-13 backfill runs never converged because of exactly this".
//
// NOTE: scripts/backfill-customers-from-purchases.js deliberately mirrors
// this in plain JS. That mirror is documented and stays - Cloud Functions
// and the scripts/ tools run in different toolchains with no module both can
// import. It is not what this consolidates.

/** The fields a difference can be queued against. */
export type PendingField =
  | "firstName"
  | "lastName"
  | "phone"
  | "shippingAddress"
  | "billingAddress";

/** One queued disagreement, awaiting an admin's decision. */
export interface PendingCustomerChange {
  field: PendingField;
  currentValue: unknown;
  proposedValue: unknown;
  source: "purchase" | "eventRegistration";
  sourceId: string;
  detectedDate: Timestamp;
}

export interface AddressLike {
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

export interface PhoneLike {
  countryCode?: string;
  number?: string;
  extension?: string;
  type?: string;
}

/** What the caller writes back to the customer document. */
export interface ReconcileResult {
  directUpdates: Record<string, unknown>;
  pendingChanges: PendingCustomerChange[];
  changed: boolean;
}

/** Field-by-field address comparison, each field trimmed + lowercased, so
 *  case and whitespace are not treated as a real difference. */
export function addressesDiffer(
  a?: AddressLike | null,
  b?: AddressLike | null
): boolean {
  const norm = (value?: string) => (value ?? "").trim().toLowerCase();
  const keys: (keyof AddressLike)[] =
    ["address1", "address2", "city", "state", "zip", "country"];
  return keys.some((key) => norm(a?.[key]) !== norm(b?.[key]));
}

/**
 * Applies the fill-or-flag rule to one customer, accumulating both the
 * direct updates and the queued disagreements.
 *
 * The rule, identical for every field type:
 *  - nothing worth proposing (absent, or junk that normalizes to empty)
 *    -> do nothing. This is the guard the phone bug above needed: junk and
 *    "nothing on file" must not look the same.
 *  - nothing on file -> fill it in directly.
 *  - on file and equal once normalized -> leave alone. Case, whitespace and
 *    phone punctuation are not real differences.
 *  - on file and genuinely different -> QUEUE it. An unverified checkout
 *    form is not a trustworthy enough source to silently correct someone's
 *    name, number or address.
 */
export class CustomerReconciler {
  private readonly pending: PendingCustomerChange[];
  private readonly directUpdates: Record<string, unknown> = {};
  private readonly now = Timestamp.now();
  private changed = false;

  constructor(
    private readonly customer: Record<string, unknown>,
    private readonly source: PendingCustomerChange["source"],
    private readonly sourceId: string
  ) {
    const existing = customer.pendingChanges;
    this.pending = Array.isArray(existing) ?
      [...existing] as PendingCustomerChange[] :
      [];
  }

  /** Queues a disagreement, REPLACING any earlier one for the same field so
   *  the queue never accumulates duplicates for one field. */
  private flag(
    field: PendingField,
    currentValue: unknown,
    proposedValue: unknown
  ): void {
    const entry: PendingCustomerChange = {
      field,
      currentValue: currentValue ?? null,
      proposedValue,
      source: this.source,
      sourceId: this.sourceId,
      detectedDate: this.now,
    };
    const index = this.pending.findIndex((p) => p.field === field);
    if (index >= 0) {
      this.pending[index] = entry;
    } else {
      this.pending.push(entry);
    }
    this.changed = true;
  }

  /** firstName / lastName. */
  name(field: "firstName" | "lastName", proposedRaw: unknown): void {
    const proposed = typeof proposedRaw === "string" ? proposedRaw.trim() : "";
    if (!proposed) {
      return;
    }
    const currentValue = this.customer[field];
    if (!normalizedName(currentValue)) {
      this.directUpdates[field] = proposed;
      this.changed = true;
      return;
    }
    if (normalizedName(currentValue) === normalizedName(proposed)) {
      return;
    }
    this.flag(field, currentValue, proposed);
  }

  /** phone. Compared on DIGITS, so punctuation is not a difference. */
  phone(proposed?: PhoneLike): void {
    const proposedDigits = normalizedPhoneDigits(proposed?.number);
    if (!proposedDigits) {
      // Not real phone data - missing, or garbage like "x"/"Y" that strips
      // to zero digits. Without this the junk looks identical to "nothing
      // on file" and refills the blank forever; see the header note.
      return;
    }
    const currentValue = this.customer.phone as PhoneLike | undefined;
    const currentDigits = normalizedPhoneDigits(currentValue?.number);
    if (!currentDigits) {
      this.directUpdates.phone = proposed;
      this.changed = true;
      return;
    }
    if (currentDigits === proposedDigits) {
      return;
    }
    this.flag("phone", currentValue, proposed);
  }

  /** shippingAddress / billingAddress. An address with no address1 is not
   *  worth proposing. */
  address(
    field: "shippingAddress" | "billingAddress",
    proposed?: AddressLike
  ): void {
    if (!proposed?.address1) {
      return;
    }
    const currentValue = this.customer[field] as AddressLike | undefined;
    if (!currentValue?.address1) {
      this.directUpdates[field] = proposed;
      this.changed = true;
      return;
    }
    if (!addressesDiffer(currentValue, proposed)) {
      return;
    }
    this.flag(field, currentValue, proposed);
  }

  /** Everything the caller needs to write back. */
  result(): ReconcileResult {
    return {
      directUpdates: this.directUpdates,
      pendingChanges: this.pending,
      changed: this.changed,
    };
  }
}
