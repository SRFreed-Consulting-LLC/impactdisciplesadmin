import {triggerPath} from "./common/shared/lists/tenancy";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {getFirestore} from "firebase-admin/firestore";
import {hasPhysicalItem} from "./utils/cart-items.functions";
import {
  findOrCreateCustomer,
  isPlausibleEmail,
} from "./utils/customer-match.functions";
import {
  AddressLike,
  CustomerReconciler,
} from "./utils/customer-reconcile";
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

export const onPurchaseCustomerUpsert = onDocumentCreated(
  triggerPath("purchases", "{id}"),
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

    // The lookup and the create share one transaction - two purchases from
    // the same NEW address arriving together otherwise both see "no such
    // customer" and both create one. See findOrCreateCustomer.
    const {ref: customerRef, created, data: customer} =
      await findOrCreateCustomer(db, email, {
        firstName: data.firstName ?? "",
        lastName: data.lastName ?? "",
        phone: data.phone,
        shippingAddress: proposedShipping,
        billingAddress: proposedBilling,
      });

    if (created) {
      // Brand new customer - nothing to compare against yet, so nothing is
      // ever queued as pending on creation.
      await applyTagRulesForActivity(db, activity, customerRef);
      return;
    }
    // One reconciler, shared with the event-registration trigger (P6).
    const reconciler = new CustomerReconciler(
      customer as Record<string, unknown>, "purchase", event.params.id
    );

    reconciler.name("firstName", data.firstName);
    reconciler.name("lastName", data.lastName);
    reconciler.phone(data.phone);
    reconciler.address("shippingAddress", proposedShipping);
    reconciler.address("billingAddress", proposedBilling);

    const {directUpdates, pendingChanges, changed} = reconciler.result();
    if (changed) {
      await customerRef.update({...directUpdates, pendingChanges});
    }

    await applyTagRulesForActivity(db, activity, customerRef);
  }
);
