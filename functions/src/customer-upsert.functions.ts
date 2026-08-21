import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {Timestamp, getFirestore} from "firebase-admin/firestore";
import {hasPhysicalItem} from "./utils/cart-items.functions";
import {
  isPlausibleEmail,
  normalizedName,
  normalizedPhoneDigits,
} from "./utils/customer-match.functions";
import {
  activityFromPurchase,
  applyTagRulesForActivity,
} from "./tag-rules.functions";

// Every purchase now creates or updates a "customers" record - see
// src/app/common/models/domain/utils/customer.model.ts's own comment (this
// is one of two sources that feed it now - see also
// event-registration-customer-upsert.functions.ts). This is another
// independent onCreate trigger on the "purchases" collection (see
// purchase-fulfillment.functions.ts's own comment on why several of these
// coexist). "Everyone who orders is a customer" - there's no opt-in flag
// gating this (CheckoutForm.isCreateAccount exists on the model but was
// always dead/unwired, on purpose left that way rather than resurrected as
// a gate here).
//
// Matched by email (lowercased/trimmed) - the only identifier a purchase
// and a customer share; there is no customerId anywhere. New email -> new
// customer record. Existing email, per field (firstName/lastName/phone/
// shipping+billing address, the last two only when this purchase actually
// has a physical item - see hasPhysicalItem):
//  - nothing on file yet for that field -> filled in directly. Not a
//    disagreement, there was nothing to disagree WITH.
//  - something's on file and it normalized-matches the purchase's value
//    (see normalizedName/normalizedPhoneDigits/addressesDiffer below -
//    case, whitespace, and phone punctuation are not real differences) ->
//    left alone.
//  - something's on file and it genuinely differs -> queued as a
//    PendingCustomerChange rather than silently overwritten - an
//    unverified checkout form is not a trustworthy enough source to
//    silently correct someone's on-file name/number/address.
// Billing defaults to the shipping address when
// CheckoutForm.isShippingSameAsBilling is set, matching how the
// storefront's own checkout form treats that flag.
//
// scripts/backfill-customers-from-purchases.js mirrors this exact logic
// (a separate, plain-JS implementation - Cloud Functions and the scripts/
// tools run in different toolchains, there's no single module both could
// import) to backfill customers from purchases that predate this trigger -
// keep the two in sync if this ever changes.
//
// A second purchase before an earlier flag on the same field is resolved
// replaces that field's pending entry with the newer proposed value rather
// than accumulating duplicates - see resolvePendingChange() in
// customer-dialog.component.ts for the admin-side resolution flow.

interface AddressLike {
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

interface PhoneLike {
  countryCode?: string;
  number?: string;
  extension?: string;
  type?: string;
}

type PendingField =
  | "firstName"
  | "lastName"
  | "phone"
  | "shippingAddress"
  | "billingAddress";

interface PendingCustomerChange {
  field: PendingField;
  currentValue: unknown;
  proposedValue: unknown;
  source: "purchase" | "eventRegistration";
  sourceId: string;
  detectedDate: Timestamp;
}

/**
 * Field-by-field address comparison, each field trimmed + lowercased first
 * (same reasoning as normalizedName) - a plain `!==` on the objects would
 * always be true (different object identities).
 * @param {AddressLike | null | undefined} a First address.
 * @param {AddressLike | null | undefined} b Second address.
 * @return {boolean} Whether any comparable field differs.
 */
function addressesDiffer(
  a?: AddressLike | null,
  b?: AddressLike | null
): boolean {
  if (!a && !b) {
    return false;
  }
  if (!a || !b) {
    return true;
  }
  const fields: (keyof AddressLike)[] =
    ["address1", "address2", "city", "state", "zip", "country"];
  return fields.some((f) => normalizedName(a[f]) !== normalizedName(b[f]));
}

export const onPurchaseCustomerUpsert = onDocumentCreated(
  "purchases/{id}",
  async (event) => {
    const data = event.data?.data();
    const email = typeof data?.email === "string" ?
      data.email.trim().toLowerCase() : "";

    if (!data || !isPlausibleEmail(email)) {
      return;
    }

    // (The "Store Customer" Mailchimp source tag that used to be applied
    // here went with the Mailchimp sync, 2026-08-20 - tag_rules on
    // purchases are the app's own equivalent.)

    const db = getFirestore();
    const existingSnap = await db.collection("customers")
      .where("email", "==", email)
      .limit(1)
      .get();

    const isPhysical = hasPhysicalItem(data.cartItems);
    const proposedShipping: AddressLike | undefined =
      isPhysical ? data.shippingAddress : undefined;
    const sameAsBilling = data.isShippingSameAsBilling;
    const proposedBilling: AddressLike | undefined = isPhysical ?
      (sameAsBilling ? data.shippingAddress : data.billingAddress) :
      undefined;

    // Tag rules (see tag-rules.functions.ts) evaluate on EVERY purchase,
    // both branches below - the customer ref is captured so the brand-new
    // branch can tag too. NOTE for the mirror contract with
    // scripts/backfill-customers-from-purchases.js: tagging is deliberately
    // NOT mirrored into that script - historic tagging is the
    // applyTagRuleRetroactively callable's job.
    const activity = activityFromPurchase(data, event.params.id, email);

    if (existingSnap.empty) {
      // Brand new customer - nothing to compare against yet, so nothing is
      // ever queued as pending on creation.
      const newRef = await db.collection("customers").add({
        firstName: data.firstName ?? "",
        lastName: data.lastName ?? "",
        email,
        phone: data.phone,
        shippingAddress: proposedShipping,
        billingAddress: proposedBilling,
        role: "Customer",
        notes: [],
        pendingChanges: [],
        tags: [],
      });
      await applyTagRulesForActivity(db, activity, newRef);
      return;
    }

    const customerDoc = existingSnap.docs[0];
    const customer = customerDoc.data();
    const existingPending = customer.pendingChanges;
    const pending: PendingCustomerChange[] =
      Array.isArray(existingPending) ? [...existingPending] : [];
    const now = Timestamp.now();
    const directUpdates: Record<string, unknown> = {};
    let changed = false;

    const flagChange = (
      field: PendingField,
      currentValue: unknown,
      proposedValue: unknown
    ) => {
      const entry: PendingCustomerChange = {
        field,
        currentValue: currentValue ?? null,
        proposedValue,
        source: "purchase",
        sourceId: event.params.id,
        detectedDate: now,
      };
      const idx = pending.findIndex((p) => p.field === field);
      if (idx >= 0) {
        pending[idx] = entry;
      } else {
        pending.push(entry);
      }
      changed = true;
    };

    const resolveNameField = (
      field: "firstName" | "lastName",
      proposedRaw: unknown
    ) => {
      const proposed =
        typeof proposedRaw === "string" ? proposedRaw.trim() : "";
      if (!proposed) {
        return;
      }
      const currentValue = customer[field];
      if (!normalizedName(currentValue)) {
        directUpdates[field] = proposed;
        changed = true;
        return;
      }
      if (normalizedName(currentValue) === normalizedName(proposed)) {
        return;
      }
      flagChange(field, currentValue, proposed);
    };

    const resolvePhoneField = (proposed?: PhoneLike) => {
      const proposedDigits = normalizedPhoneDigits(proposed?.number);
      if (!proposedDigits) {
        // Not real phone data (missing, or garbage like "x"/"Y" that
        // strips to zero digits) - nothing worth filling or flagging with.
        // Without this check, a junk value that also normalizes to ""
        // looks identical to "nothing on file", so a blank field would get
        // "filled" with the same junk on every future purchase, forever
        // (live-diagnosed: two 2026-08-13 backfill runs never converged
        // because of exactly this).
        return;
      }
      const currentValue: PhoneLike | undefined = customer.phone;
      const currentDigits = normalizedPhoneDigits(currentValue?.number);
      if (!currentDigits) {
        directUpdates.phone = proposed;
        changed = true;
        return;
      }
      if (currentDigits === proposedDigits) {
        return;
      }
      flagChange("phone", currentValue, proposed);
    };

    const resolveAddressField = (
      field: "shippingAddress" | "billingAddress",
      proposed?: AddressLike
    ) => {
      if (!proposed?.address1) {
        return;
      }
      const currentValue: AddressLike | undefined = customer[field];
      if (!currentValue?.address1) {
        directUpdates[field] = proposed;
        changed = true;
        return;
      }
      if (!addressesDiffer(currentValue, proposed)) {
        return;
      }
      flagChange(field, currentValue, proposed);
    };

    resolveNameField("firstName", data.firstName);
    resolveNameField("lastName", data.lastName);
    resolvePhoneField(data.phone);
    resolveAddressField("shippingAddress", proposedShipping);
    resolveAddressField("billingAddress", proposedBilling);

    if (changed) {
      await customerDoc.ref.update({...directUpdates, pendingChanges: pending});
    }

    await applyTagRulesForActivity(db, activity, customerDoc.ref);
  }
);
