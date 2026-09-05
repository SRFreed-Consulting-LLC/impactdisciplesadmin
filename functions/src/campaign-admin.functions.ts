import {TENANT_ID, tenantPath} from "./common/shared/lists/tenancy";
const EMAILS = tenantPath("campaign_emails");
const POPUPS = tenantPath("campaign_popups");
const CAMPAIGNS = tenantPath("campaigns");
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {requireAdminRole} from "./admin-users.functions";
import {Timestamp, getFirestore} from "firebase-admin/firestore";
import {getStorage} from "firebase-admin/storage";
import {
  DeleteCampaignRequest,
  DeleteCampaignResult,
} from "./common/shared/contract/admin-callables.types";

// Campaign delete (2026-08-20, server-side since the same day's follow-up):
// one callable, `deleteCampaign`, with a dryRun mode the confirm dialog
// uses and an execute mode that cascades:
//   1. refuses while any touch is sending/scheduled (the engine is still
//      draining its ledger - a deleted touch would strand it);
//   2. deletes every campaign_emails touch (incl. website-published ones),
//      the campaign_popups/{id} doc, then the campaign doc;
//   3. (user requirement) deletes the campaign's images from OUR Storage
//      bucket when nothing else references them: every firebasestorage
//      download URL found in the campaign/touch/popup docs is a candidate;
//      after the docs are gone, every content-bearing collection in the
//      default DB is scanned for the object path (encoded or plain) and
//      only zero-reference objects are removed. Shared assets (the
//      re-hosted Mailchimp images used by dozens of emails, product photos
//      reused in a promo) survive by construction.
// NOT touched: campaign_sends / campaign_events (function-owned audit
// rows; the send engine tolerates a missing touch) and tag_applications
// (customer facts). Caveat, inherent to "delete unused images": an image
// removed here also stops loading inside already-delivered copies of that
// campaign's emails (recipients' inboxes fetch it from our bucket).
//
// Why server-side: the reference scan reads whole content collections
// (campaign_emails alone is ~12MB of html) - far cheaper via the Admin SDK
// than from the browser, and Storage deletes should not hinge on a tab
// staying open.

// Collections that never hold image references and are large - skipped by
// the reference scan. Anything NOT listed here (including future
// collections) IS scanned: the safe default is "assume it might reference
// the image".
const SCAN_DENYLIST = new Set([
  "customers", "purchases", "pending_orders", "event-registrations",
  "tag_applications", "campaign_sends", "campaign_events", "mail",
  "log-messages", "errorLogs", "activityLog", "affilliate_sales",
  "tax_rates", "tax_rate_summaries", "notification_registrations",
  "admin_users", "users", "libraryUsers", "impact-users", "sales",
  "shipping-labels", "shipping-label-batches", "meta",
  "integration_settings", "subscriptions",
]);

export interface StorageRef {
  bucket: string;
  objectPath: string;
}

/**
 * Extracts every Firebase Storage download URL's {bucket, objectPath} from
 * a value's strings (recursively). Matches the
 * firebasestorage.googleapis.com/v0/b/<bucket>/o/<encodedPath> shape the
 * app writes everywhere; ignores anything else.
 * @param {unknown} value Any Firestore field value / doc data.
 * @param {Map<string, StorageRef>} into Accumulator keyed bucket/path.
 */
export function collectStorageRefs(
  value: unknown,
  into: Map<string, StorageRef>
): void {
  if (typeof value === "string") {
    const re = new RegExp(
      "https://firebasestorage\\.googleapis\\.com/v0/b/([^/]+)/o/" +
      "([^?\"'\\s<>)]+)", "g");
    for (const m of value.matchAll(re)) {
      try {
        const objectPath = decodeURIComponent(m[2]);
        into.set(`${m[1]}/${objectPath}`, {bucket: m[1], objectPath});
      } catch {
        // malformed percent-encoding - not one of ours
      }
    }
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectStorageRefs(v, into));
  } else if (value && typeof value === "object" &&
      !(value instanceof Timestamp)) {
    Object.values(value as Record<string, unknown>)
      .forEach((v) => collectStorageRefs(v, into));
  }
}

/**
 * Whether a serialized doc references an object path - encoded (download
 * URL) or plain (a raw path some pickers store).
 * @param {string} serialized JSON of the doc data.
 * @param {string} objectPath Decoded object path.
 * @return {boolean} True when referenced.
 */
export function referencesPath(
  serialized: string,
  objectPath: string
): boolean {
  return serialized.includes(objectPath) ||
    serialized.includes(encodeURIComponent(objectPath));
}

/**
 * The collections the reference scan reads: everything under the tenant
 * document PLUS the database root, minus the denylist. Root alone has been
 * wrong since the 2026-09-02 cutover - `listCollections()` on the root
 * never descends into `tenants/{id}`, so page_content, products and every
 * other campaign were invisible to the scan and any image they shared with
 * the deleted campaign was removed from Storage.
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @return {Promise<FirebaseFirestore.CollectionReference[]>} To scan.
 */
export async function collectionsToScan(
  db: FirebaseFirestore.Firestore
): Promise<FirebaseFirestore.CollectionReference[]> {
  const [tenant, root] = await Promise.all([
    db.doc(`tenants/${TENANT_ID}`).listCollections(),
    db.listCollections(),
  ]);
  return [...tenant, ...root].filter((c) => !SCAN_DENYLIST.has(c.id));
}

interface TouchDoc {
  id: string;
  status?: string;
  label?: string | null;
  subject?: string;
  publishToWeb?: boolean;
}

interface Loaded {
  campaign: FirebaseFirestore.DocumentSnapshot;
  touches: FirebaseFirestore.QueryDocumentSnapshot[];
  popup: FirebaseFirestore.DocumentSnapshot;
}

/**
 * Loads the campaign and its dependents.
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @param {string} campaignId Campaign doc id.
 * @return {Promise<Loaded>} The docs.
 */
async function load(
  db: FirebaseFirestore.Firestore,
  campaignId: string
): Promise<Loaded> {
  const [campaign, touchesSnap, popup] = await Promise.all([
    db.collection(CAMPAIGNS).doc(campaignId).get(),
    db.collection(EMAILS)
      .where("campaignId", "==", campaignId).get(),
    db.collection(POPUPS).doc(campaignId).get(),
  ]);
  if (!campaign.exists) {
    throw new HttpsError("not-found", "Campaign not found.");
  }
  return {campaign, touches: touchesSnap.docs, popup};
}

/**
 * The pre-delete plan (what the confirm dialog shows).
 * @param {Loaded} loaded The docs.
 * @return {object} Plan.
 */
function planFor(loaded: Loaded) {
  const touches = loaded.touches
    .map((d) => ({id: d.id, ...d.data()} as TouchDoc));
  const refs = new Map<string, StorageRef>();
  collectStorageRefs(loaded.campaign.data(), refs);
  loaded.touches.forEach((d) => collectStorageRefs(d.data(), refs));
  if (loaded.popup.exists) collectStorageRefs(loaded.popup.data(), refs);
  return {
    name: String(loaded.campaign.data()?.name ?? ""),
    emailCount: touches.length,
    publishedCount: touches.filter((t) => t.publishToWeb === true).length,
    hasPopup: loaded.popup.exists,
    inFlight: touches
      .filter((t) => t.status === "sending" || t.status === "scheduled")
      .map((t) => t.label || t.subject || t.id),
    imageCandidates: refs.size,
    refs,
  };
}

/**
 * Deletes the candidate objects that nothing in the database references
 * any more. Reads each non-denylisted collection ONCE and tests every
 * candidate against it, so cost is (collections) not (collections x images).
 * @param {FirebaseFirestore.Firestore} db Firestore.
 * @param {Map<string, StorageRef>} refs Candidates.
 * @return {Promise<{deleted: string[], kept: string[], failed: string[]}>}
 *   Outcome.
 */
async function deleteUnreferencedImages(
  db: FirebaseFirestore.Firestore,
  refs: Map<string, StorageRef>
): Promise<{deleted: string[]; kept: string[]; failed: string[]}> {
  const pending = new Map(refs); // still unreferenced so far
  const kept: string[] = [];
  if (pending.size > 0) {
    const collections = await collectionsToScan(db);
    for (const collection of collections) {
      if (pending.size === 0) break;
      const snap = await collection.get();
      for (const doc of snap.docs) {
        if (pending.size === 0) break;
        const serialized = JSON.stringify(doc.data());
        for (const [key, ref] of [...pending]) {
          if (referencesPath(serialized, ref.objectPath)) {
            pending.delete(key);
            kept.push(ref.objectPath);
          }
        }
      }
    }
  }
  const deleted: string[] = [];
  const failed: string[] = [];
  for (const ref of pending.values()) {
    try {
      await getStorage().bucket(ref.bucket).file(ref.objectPath)
        .delete({ignoreNotFound: true});
      deleted.push(ref.objectPath);
    } catch (err) {
      console.error("deleteCampaign: image delete failed", ref, err);
      failed.push(ref.objectPath);
    }
  }
  return {deleted, kept, failed};
}

// callable deleteCampaign({campaignId, dryRun?})
//   dryRun  -> {name, emailCount, publishedCount, hasPopup, inFlight[],
//               imageCandidates}
//   execute -> {emailsDeleted, popupDeleted, imagesDeleted[], imagesKept[],
//               imagesFailed[]}
export const deleteCampaign = onCall(async (request):
  Promise<DeleteCampaignResult> => {
  await requireAdminRole(request.auth?.uid);
  const {campaignId, dryRun} =
    (request.data ?? {}) as Partial<DeleteCampaignRequest>;
  if (!campaignId || typeof campaignId !== "string") {
    throw new HttpsError("invalid-argument", "campaignId is required.");
  }
  const db = getFirestore();
  const loaded = await load(db, campaignId);
  const plan = planFor(loaded);
  if (dryRun) {
    const {refs, ...rest} = plan;
    void refs;
    return rest;
  }
  if (plan.inFlight.length > 0) {
    throw new HttpsError("failed-precondition",
      "Cannot delete while emails are sending or scheduled: " +
      plan.inFlight.join(", "));
  }

  // Docs first (in dependency order), so the reference scan below sees
  // the world WITHOUT this campaign.
  for (const touch of loaded.touches) {
    await touch.ref.delete();
  }
  if (loaded.popup.exists) {
    await loaded.popup.ref.delete();
  }
  await loaded.campaign.ref.delete();

  const images = await deleteUnreferencedImages(db, plan.refs);
  console.log(`deleteCampaign ${campaignId} "${plan.name}": ` +
    `${loaded.touches.length} emails, popup=${loaded.popup.exists}, ` +
    `images deleted ${images.deleted.length}, kept ${images.kept.length}, ` +
    `failed ${images.failed.length}`);
  return {
    emailsDeleted: loaded.touches.length,
    popupDeleted: loaded.popup.exists,
    imagesDeleted: images.deleted,
    imagesKept: images.kept,
    imagesFailed: images.failed,
  };
});
