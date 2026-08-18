import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
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
//  - retroactive: applyTagRuleRetroactively (admin callable) sweeps the
//    historic collections for one rule
// NOTE "event registration" is deliberately the trigger, not "attendance" -
// this system has no check-in/attended concept (EventRegistrationModel.
// loggedIn is written false and never set true anywhere); if real
// attendance tracking ever lands, add an 'event-attendance' trigger value
// rather than repurposing this one.

export type TagRuleTrigger = "purchase" | "event-registration";

export interface TagRuleDoc {
  id: string;
  name?: string;
  trigger?: TagRuleTrigger;
  productId?: string | null;
  eventId?: string | null;
  tag?: string;
  active?: boolean;
}

export interface ActivityForTagging {
  source: TagRuleTrigger;
  sourceId: string;
  /** Already lowercased/trimmed. */
  email: string;
  /** Purchase: cartItems' product ids. Registration: []. */
  productIds: string[];
  /** Registration: the event id. Purchase: null. */
  eventId: string | null;
  /** Normalized purchase/registration date - the tag's anchor date. */
  activityDate: admin.firestore.Timestamp;
}

/**
 * Pure rule matcher (unit-testable without Firestore). A purchase rule
 * matches when its productId appears among the activity's product ids
 * (cartItems is an array of objects, so this in-memory check IS the query);
 * an event rule matches on eventId equality. Inactive/malformed rules
 * never match.
 * @param {TagRuleDoc[]} rules Candidate rules.
 * @param {ActivityForTagging} activity The purchase/registration activity.
 * @return {TagRuleDoc[]} The rules that apply.
 */
export function matchRules(
  rules: TagRuleDoc[],
  activity: ActivityForTagging
): TagRuleDoc[] {
  return rules.filter((rule) => {
    if (rule.active === false || !rule.tag?.trim()) {
      return false;
    }
    if (rule.trigger === "purchase") {
      return activity.source === "purchase" &&
        !!rule.productId &&
        activity.productIds.includes(rule.productId);
    }
    if (rule.trigger === "event-registration") {
      return activity.source === "event-registration" &&
        !!rule.eventId &&
        activity.eventId === rule.eventId;
    }
    return false;
  });
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
      toTimestamp(data.dateProcessed) ?? admin.firestore.Timestamp.now(),
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
    activityDate:
      toTimestamp(data.registrationDate) ?? admin.firestore.Timestamp.now(),
  };
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
 * Applies one matched rule's tag to a customer: arrayUnion on the customer
 * doc plus a create-if-absent tag_applications doc. create() throwing
 * already-exists is swallowed ON PURPOSE - it preserves the ORIGINAL
 * anchorDate, so a repeat purchase never resets a customer's N-day clock.
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @param {FirebaseFirestore.DocumentReference} customerRef Customer doc.
 * @param {ActivityForTagging} activity The triggering activity.
 * @param {TagRuleDoc} rule The matched rule (rule.tag verified nonempty).
 * @return {Promise<boolean>} Whether a new application doc was created.
 */
async function applyOneTag(
  db: FirebaseFirestore.Firestore,
  customerRef: FirebaseFirestore.DocumentReference,
  activity: ActivityForTagging,
  rule: TagRuleDoc
): Promise<boolean> {
  const tag = (rule.tag ?? "").trim();
  await customerRef.update({
    tags: admin.firestore.FieldValue.arrayUnion(tag),
  });
  try {
    await db.collection("tag_applications")
      .doc(tagApplicationId(activity.email, tag))
      .create({
        email: activity.email,
        tag,
        appliedAt: admin.firestore.Timestamp.now(),
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
 * against this activity and apply the hits. Failures are logged, never
 * thrown - tagging must not break the upsert pipeline it rides on.
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
    const matched = matchRules(rules, activity);
    for (const rule of matched) {
      await applyOneTag(db, customerRef, activity, rule);
    }
  } catch (err) {
    console.error("Tag rule application failed", activity.sourceId, err);
  }
}

const PAGE_SIZE = 500;

/**
 * Admin-triggered retroactive sweep for ONE rule: pages the historic
 * purchases or event-registrations collection server-side (an admin's
 * browser never downloads the collections), matches each doc against just
 * this rule, and tags the matching customers with the HISTORIC activity
 * date as the anchor. Customers that don't exist yet are skipped - the
 * customer-upsert backfill scripts own creating customers, not this.
 * Deterministic application ids make re-runs idempotent.
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
    if (!rule.tag?.trim()) {
      throw new HttpsError("failed-precondition", "Rule has no tag.");
    }

    const isPurchaseRule = rule.trigger === "purchase";
    const collection = isPurchaseRule ? "purchases" : "event-registrations";

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
          db, customerSnap.docs[0].ref, activity, rule
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
);
