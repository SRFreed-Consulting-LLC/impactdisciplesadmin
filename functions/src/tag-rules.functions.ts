import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {Timestamp, FieldValue} from "firebase-admin/firestore";
import {requireAdminRole} from "./admin-users.functions";
import {toTimestamp} from "./utils/date-normalize.functions";

// Customer tag rules: "customer purchased product X => tag 'Impact 1'",
// "customer registered for event Y => tag 'DMC'". Rules live in the
// `tag_rules` collection (authored on Campaigns Manager > Tag Rules);
// matching tags land on the customer doc's `tags: string[]` (arrayUnion)
// AND as a `tag_applications/{email__tag}` doc recording WHEN/WHY - the
// anchor date the auto-campaign scheduler's "N days after" clock runs
// from, plus an audit trail. Two write paths share matchRules():
//  - live: the customer-upsert triggers call applyTagRulesForActivity()
//    for every new purchase / event registration
//  - retroactive: applyTagRuleRetroactively (admin callable) and
//    scripts/backfill-tag-rules.js both call runRuleBackfill() to sweep
//    the historic collections for one rule
// NOTE "event registration" is deliberately the trigger, not "attendance" -
// this system has no check-in/attended concept (EventRegistrationModel.
// loggedIn is written false and never set true anywhere); if real
// attendance tracking ever lands, add an 'event-attendance' trigger value
// rather than repurposing this one.
//
// Rule shapes (extended 2026-08-20 for the Impact/DMC/Summit rule set):
//  - purchase rules match ANY product in `productIds` (legacy single
//    `productId` still honored) against the purchase's cart items - a
//    bundle product listed in several rules applies several tags.
//  - event-registration rules match ANY event in `eventIds` (legacy
//    single `eventId` honored).
//  - 'summit-registration' rules have no event list: they match a
//    registration for ANY event whose doc has isSummit=true (so future
//    summits are covered automatically) and apply exactly ONE of two
//    tags - `paidTag` when the registration was paid for, `tag` when it
//    was free. Paid-ness comes from the registration's `receipt`: the
//    public checkout stores the PayPal/Stripe payment id on paid
//    registrations and the COUPON CODE on 100%-off free ones (see the
//    web repo's checkout-success.component), so "receipt present and not
//    a known coupon code" = paid.

export type TagRuleTrigger =
  "purchase" | "event-registration" | "summit-registration";

export interface TagRuleDoc {
  id: string;
  name?: string;
  trigger?: TagRuleTrigger;
  /** Legacy single-product shape; superseded by productIds. */
  productId?: string | null;
  productIds?: string[] | null;
  /** Legacy single-event shape; superseded by eventIds. */
  eventId?: string | null;
  eventIds?: string[] | null;
  /** The tag applied; for summit rules, the FREE-registration tag. */
  tag?: string;
  /** Summit rules only: the tag applied to paid registrations. */
  paidTag?: string | null;
  active?: boolean;
}

export interface ActivityForTagging {
  source: "purchase" | "event-registration";
  sourceId: string;
  /** Already lowercased/trimmed. */
  email: string;
  /** Purchase: cartItems' product ids. Registration: []. */
  productIds: string[];
  /** Registration: the event id. Purchase: null. */
  eventId: string | null;
  /** Registration: raw receipt (payment id, coupon code, or ''). */
  receipt?: string;
  /** Enrichment (summit rules): the registered event's isSummit flag. */
  isSummit?: boolean;
  /** Enrichment (summit rules): the registration was actually paid for. */
  paid?: boolean;
  /** Normalized purchase/registration date - the tag's anchor date. */
  activityDate: Timestamp;
}

/**
 * A rule's effective product-id list (multi shape first, legacy single
 * shape as fallback).
 * @param {TagRuleDoc} rule The rule.
 * @return {string[]} Product ids the rule matches on.
 */
export function ruleProductIds(rule: TagRuleDoc): string[] {
  if (Array.isArray(rule.productIds) && rule.productIds.length > 0) {
    return rule.productIds.filter((id) => typeof id === "string" && !!id);
  }
  return rule.productId ? [rule.productId] : [];
}

/**
 * A rule's effective event-id list (multi shape first, legacy single
 * shape as fallback).
 * @param {TagRuleDoc} rule The rule.
 * @return {string[]} Event ids the rule matches on.
 */
export function ruleEventIds(rule: TagRuleDoc): string[] {
  if (Array.isArray(rule.eventIds) && rule.eventIds.length > 0) {
    return rule.eventIds.filter((id) => typeof id === "string" && !!id);
  }
  return rule.eventId ? [rule.eventId] : [];
}

/**
 * The tag a matched rule applies to THIS activity: summit rules pick
 * paidTag vs tag off activity.paid; everything else is rule.tag. '' means
 * "no tag to apply" and the rule must not match.
 * @param {TagRuleDoc} rule The rule.
 * @param {ActivityForTagging} activity The activity.
 * @return {string} The tag, or '' when the rule yields none.
 */
export function resolveTag(
  rule: TagRuleDoc,
  activity: ActivityForTagging
): string {
  if (rule.trigger === "summit-registration") {
    return ((activity.paid ? rule.paidTag : rule.tag) ?? "").trim();
  }
  return (rule.tag ?? "").trim();
}

/**
 * Pure rule matcher (unit-testable without Firestore). A purchase rule
 * matches when any of its product ids appears among the activity's product
 * ids (cartItems is an array of objects, so this in-memory check IS the
 * query); an event rule matches when the activity's eventId is in its
 * list; a summit rule matches any registration whose event was enriched
 * to isSummit. Inactive/malformed rules never match.
 * @param {TagRuleDoc[]} rules Candidate rules.
 * @param {ActivityForTagging} activity The purchase/registration activity.
 * @return {TagRuleDoc[]} The rules that apply.
 */
export function matchRules(
  rules: TagRuleDoc[],
  activity: ActivityForTagging
): TagRuleDoc[] {
  return rules.filter((rule) => {
    if (rule.active === false || !resolveTag(rule, activity)) {
      return false;
    }
    if (rule.trigger === "purchase") {
      return activity.source === "purchase" &&
        ruleProductIds(rule)
          .some((id) => activity.productIds.includes(id));
    }
    if (rule.trigger === "event-registration") {
      return activity.source === "event-registration" &&
        !!activity.eventId &&
        ruleEventIds(rule).includes(activity.eventId);
    }
    if (rule.trigger === "summit-registration") {
      return activity.source === "event-registration" &&
        activity.isSummit === true;
    }
    return false;
  });
}

/**
 * Whether a registration receipt represents real payment: non-empty and
 * not one of the store's coupon codes (the free-checkout path stores the
 * coupon code as the receipt).
 * @param {string|undefined} receipt The registration's receipt field.
 * @param {Set<string>} couponCodesUpper All coupon codes, uppercased.
 * @return {boolean} Whether the registration was paid for.
 */
export function registrationWasPaid(
  receipt: string | undefined,
  couponCodesUpper: Set<string>
): boolean {
  const value = (receipt ?? "").trim();
  if (!value) {
    return false;
  }
  return !couponCodesUpper.has(value.toUpperCase());
}

/**
 * Deterministic tag_applications doc id - one doc per (customer, tag), so
 * repeat activity can never duplicate an application or reset its anchor.
 * '/' can appear in neither an email nor a validated tag (the Tag Rules
 * screen rejects it), so the composite is a safe doc id.
 * @param {string} email Lowercased customer email.
 * @param {string} tag The tag.
 * @return {string} The doc id.
 */
export function tagApplicationId(email: string, tag: string): string {
  return `${email}__${tag}`;
}

/**
 * Builds an ActivityForTagging from a purchase doc.
 * @param {FirebaseFirestore.DocumentData} data The purchase doc data.
 * @param {string} sourceId The purchase doc id.
 * @param {string} email Lowercased buyer email.
 * @return {ActivityForTagging} The normalized activity.
 */
export function activityFromPurchase(
  data: FirebaseFirestore.DocumentData,
  sourceId: string,
  email: string
): ActivityForTagging {
  const cartItems = Array.isArray(data.cartItems) ? data.cartItems : [];
  const productIds = cartItems
    .map((item: {id?: unknown}) =>
      typeof item?.id === "string" ? item.id : "")
    .filter((id: string) => id !== "");
  return {
    source: "purchase",
    sourceId,
    email,
    productIds,
    eventId: null,
    activityDate:
      toTimestamp(data.dateProcessed) ?? Timestamp.now(),
  };
}

/**
 * Builds an ActivityForTagging from an event-registration doc.
 * @param {FirebaseFirestore.DocumentData} data The registration doc data.
 * @param {string} sourceId The registration doc id.
 * @param {string} email Lowercased registrant email.
 * @return {ActivityForTagging} The normalized activity.
 */
export function activityFromRegistration(
  data: FirebaseFirestore.DocumentData,
  sourceId: string,
  email: string
): ActivityForTagging {
  return {
    source: "event-registration",
    sourceId,
    email,
    productIds: [],
    eventId: typeof data.eventId === "string" ? data.eventId : null,
    receipt: typeof data.receipt === "string" ? data.receipt : "",
    activityDate:
      toTimestamp(data.registrationDate) ?? Timestamp.now(),
  };
}

/**
 * Loads every coupon code, uppercased, for registrationWasPaid().
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @return {Promise<Set<string>>} Uppercased coupon codes.
 */
export async function loadCouponCodesUpper(
  db: FirebaseFirestore.Firestore
): Promise<Set<string>> {
  const snap = await db.collection("coupons").select("code").get();
  const codes = new Set<string>();
  for (const doc of snap.docs) {
    const code = doc.data().code;
    if (typeof code === "string" && code.trim()) {
      codes.add(code.trim().toUpperCase());
    }
  }
  return codes;
}

/** Lookup caches for enriching registrations against summit rules. */
export interface SummitEnrichmentCaches {
  isSummitByEventId: Map<string, boolean>;
  couponCodesUpper: Set<string> | null;
}

/**
 * Fills a registration activity's isSummit/paid fields (both Firestore
 * lookups, memoized through `caches` so a backfill sweep does them once,
 * not per registration).
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @param {ActivityForTagging} activity Registration activity to enrich.
 * @param {SummitEnrichmentCaches} caches Cross-call lookup caches.
 * @return {Promise<void>} Resolves when the activity is enriched.
 */
export async function enrichRegistrationForSummitRules(
  db: FirebaseFirestore.Firestore,
  activity: ActivityForTagging,
  caches: SummitEnrichmentCaches
): Promise<void> {
  if (activity.source !== "event-registration" || !activity.eventId) {
    activity.isSummit = false;
    return;
  }
  if (!caches.isSummitByEventId.has(activity.eventId)) {
    const eventSnap =
      await db.collection("events").doc(activity.eventId).get();
    caches.isSummitByEventId.set(
      activity.eventId, eventSnap.exists && !!eventSnap.data()?.isSummit
    );
  }
  activity.isSummit = caches.isSummitByEventId.get(activity.eventId);
  if (!activity.isSummit) {
    return;
  }
  if (!caches.couponCodesUpper) {
    caches.couponCodesUpper = await loadCouponCodesUpper(db);
  }
  activity.paid =
    registrationWasPaid(activity.receipt, caches.couponCodesUpper);
}

/**
 * Loads the active tag rules once per invocation.
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @return {Promise<TagRuleDoc[]>} Active rules.
 */
export async function loadActiveRules(
  db: FirebaseFirestore.Firestore
): Promise<TagRuleDoc[]> {
  const snap = await db.collection("tag_rules")
    .where("active", "==", true).get();
  return snap.docs.map((doc) => ({id: doc.id, ...doc.data()} as TagRuleDoc));
}

/**
 * Applies one matched rule's resolved tag to a customer: arrayUnion on the
 * customer doc plus a create-if-absent tag_applications doc. create()
 * throwing already-exists is swallowed ON PURPOSE - it preserves the
 * ORIGINAL anchorDate, so a repeat purchase never resets a customer's
 * N-day clock.
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @param {FirebaseFirestore.DocumentReference} customerRef Customer doc.
 * @param {ActivityForTagging} activity The triggering activity.
 * @param {TagRuleDoc} rule The matched rule.
 * @param {string} tag The resolved tag (verified nonempty by matchRules).
 * @return {Promise<boolean>} Whether a new application doc was created.
 */
async function applyOneTag(
  db: FirebaseFirestore.Firestore,
  customerRef: FirebaseFirestore.DocumentReference,
  activity: ActivityForTagging,
  rule: TagRuleDoc,
  tag: string
): Promise<boolean> {
  await customerRef.update({
    tags: FieldValue.arrayUnion(tag),
  });
  try {
    await db.collection("tag_applications")
      .doc(tagApplicationId(activity.email, tag))
      .create({
        email: activity.email,
        tag,
        appliedAt: Timestamp.now(),
        anchorDate: activity.activityDate,
        source: activity.source,
        sourceId: activity.sourceId,
        ruleId: rule.id,
      });
    return true;
  } catch {
    // already-exists: this customer already carries the tag - keep the
    // original application (and its anchor date).
    return false;
  }
}

/**
 * Live-path entry point, called from the customer-upsert triggers after
 * they've resolved (or created) the customer doc: match every active rule
 * against this activity and apply the hits. Registrations are enriched
 * (event isSummit + paid-ness) only when a summit rule is active, so the
 * common case costs no extra reads. Failures are logged, never thrown -
 * tagging must not break the upsert pipeline it rides on.
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @param {ActivityForTagging} activity The purchase/registration activity.
 * @param {FirebaseFirestore.DocumentReference} customerRef Customer doc.
 * @return {Promise<void>} Resolves when tagging is done (or has failed).
 */
export async function applyTagRulesForActivity(
  db: FirebaseFirestore.Firestore,
  activity: ActivityForTagging,
  customerRef: FirebaseFirestore.DocumentReference
): Promise<void> {
  try {
    const rules = await loadActiveRules(db);
    if (activity.source === "event-registration" &&
      rules.some((rule) => rule.trigger === "summit-registration")) {
      await enrichRegistrationForSummitRules(db, activity, {
        isSummitByEventId: new Map(),
        couponCodesUpper: null,
      });
    }
    const matched = matchRules(rules, activity);
    for (const rule of matched) {
      await applyOneTag(
        db, customerRef, activity, rule, resolveTag(rule, activity)
      );
    }
  } catch (err) {
    console.error("Tag rule application failed", activity.sourceId, err);
  }
}

const PAGE_SIZE = 500;

/** Stats returned by one rule's retroactive sweep. */
export interface RuleBackfillStats {
  scanned: number;
  matched: number;
  customersTagged: number;
  applicationsCreated: number;
  skippedNoCustomer: number;
}

/**
 * Retroactive sweep for ONE rule: pages the historic purchases or
 * event-registrations collection server-side, matches each doc against
 * just this rule, and tags the matching customers with the HISTORIC
 * activity date as the anchor. Customers that don't exist yet are
 * skipped - the customer-upsert backfill scripts own creating customers,
 * not this. Deterministic application ids make re-runs idempotent.
 * Shared by the applyTagRuleRetroactively callable and
 * scripts/backfill-tag-rules.js (which requires it from functions/lib).
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @param {TagRuleDoc} rule The rule to sweep (tag/paidTag pre-validated).
 * @return {Promise<RuleBackfillStats>} Sweep statistics.
 */
export async function runRuleBackfill(
  db: FirebaseFirestore.Firestore,
  rule: TagRuleDoc
): Promise<RuleBackfillStats> {
  const isPurchaseRule = rule.trigger === "purchase";
  const collection = isPurchaseRule ? "purchases" : "event-registrations";
  const enrichmentCaches: SummitEnrichmentCaches = {
    isSummitByEventId: new Map(),
    couponCodesUpper: null,
  };

  let scanned = 0;
  let matched = 0;
  let applicationsCreated = 0;
  let skippedNoCustomer = 0;
  const taggedEmails = new Set<string>();

  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let query = db.collection(collection)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (cursor) {
      query = query.startAfter(cursor);
    }
    const page = await query.get();
    if (page.empty) {
      break;
    }
    cursor = page.docs[page.docs.length - 1];

    for (const doc of page.docs) {
      scanned++;
      const data = doc.data();
      const email = typeof data.email === "string" ?
        data.email.trim().toLowerCase() : "";
      if (!email) {
        continue;
      }
      const activity = isPurchaseRule ?
        activityFromPurchase(data, doc.id, email) :
        activityFromRegistration(data, doc.id, email);
      if (rule.trigger === "summit-registration") {
        await enrichRegistrationForSummitRules(db, activity, enrichmentCaches);
      }
      if (matchRules([rule], activity).length === 0) {
        continue;
      }
      matched++;
      const customerSnap = await db.collection("customers")
        .where("email", "==", email).limit(1).get();
      if (customerSnap.empty) {
        skippedNoCustomer++;
        continue;
      }
      const created = await applyOneTag(
        db, customerSnap.docs[0].ref, activity, rule,
        resolveTag(rule, activity)
      );
      taggedEmails.add(email);
      if (created) {
        applicationsCreated++;
      }
    }

    if (page.docs.length < PAGE_SIZE) {
      break;
    }
  }

  return {
    scanned,
    matched,
    customersTagged: taggedEmails.size,
    applicationsCreated,
    skippedNoCustomer,
  };
}

/**
 * Admin-triggered retroactive sweep for ONE rule (an admin's browser never
 * downloads the collections) - see runRuleBackfill for the semantics.
 */
export const applyTagRuleRetroactively = onCall(
  {timeoutSeconds: 540},
  async (request) => {
    await requireAdminRole(request.auth?.uid);

    const {ruleId} = (request.data ?? {}) as {ruleId?: string};
    if (!ruleId) {
      throw new HttpsError("invalid-argument", "ruleId is required.");
    }
    const db = admin.firestore();
    const ruleSnap = await db.collection("tag_rules").doc(ruleId).get();
    if (!ruleSnap.exists) {
      throw new HttpsError("not-found", "Tag rule not found.");
    }
    const rule = {id: ruleSnap.id, ...ruleSnap.data()} as TagRuleDoc;
    const hasTag = rule.trigger === "summit-registration" ?
      !!(rule.tag?.trim() || rule.paidTag?.trim()) :
      !!rule.tag?.trim();
    if (!hasTag) {
      throw new HttpsError("failed-precondition", "Rule has no tag.");
    }

    return await runRuleBackfill(db, rule);
  }
);
