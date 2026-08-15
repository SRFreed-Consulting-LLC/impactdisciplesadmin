/* eslint-disable @typescript-eslint/no-var-requires */
import {
  onDocumentCreated,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import * as crypto from "crypto";
import {isPlausibleEmail} from "./utils/customer-match.functions";

// Keeps the "customers" collection mirrored into a Mailchimp audience.
// customer-upsert.functions.ts (purchases) and
// event-registration-customer-upsert.functions.ts (event registrations) are
// the only two things that ever create a customers doc, but both the
// pending-change resolution flow (CustomerDialogComponent -> CustomerService
// .update()) and the scripts/backfill-customers-from-*.js scripts also write
// to it directly - rather than duplicate sync logic at every write site,
// this file watches the customers collection itself, so every path is
// covered automatically. Source-acquisition tags are the one thing this file
// can't infer from a bare customers doc (nothing on it says "came from a
// purchase"), so those are added by one line each in the two upsert
// functions, which do know why the customer exists - see
// addMailchimpSourceTag below.

/**
 * Every Mailchimp-specific knob in one place, editable from the admin app's
 * Tools Manager -> Mailchimp screen (src/app/tools-manager/
 * mailchimp-settings/) rather than hardcoded here - see
 * MailchimpConfigModel's own comment (src/app/common/models/utils/
 * mailchimp-config.model.ts) for the matching client-side shape. Everything
 * below is read fresh from Firestore on every invocation (see
 * getMailchimpConfig) - deliberately excludes the API key itself, which
 * stays in Secret Manager (MAILCHIMP_API_KEY) since firestore.rules is wide
 * open and anything in this doc is effectively public.
 */
interface MailchimpConfig {
  // Master switch - everything below no-ops (no Mailchimp call, nothing
  // logged as an error) while it's false, so a missing/not-yet-configured
  // settings doc behaves exactly like the integration being off.
  enabled: boolean;
  audienceId: string;
  // Mailchimp API keys are formatted "<key>-usXX" - the suffix after the
  // dash is the datacenter its REST API lives on. Left unset, it's parsed
  // off MAILCHIMP_API_KEY at call time; only set this if that ever proves
  // unreliable.
  serverPrefix?: string;
  // Applied only to brand-new Mailchimp members (see status_if_new below) -
  // never overwrites an existing member's status, so someone who
  // unsubscribed/complained in Mailchimp stays that way regardless of what
  // this app later syncs.
  defaultSubscribeStatus: "pending" | "subscribed" | "transactional";
  enableSourceTags: boolean;
  purchaseTag: string;
  eventRegistrationTag: string;
}

// Fallback used whenever the settings doc doesn't exist yet (integration
// never configured from the admin screen) or is missing a field (e.g. a
// field added after some deployments already wrote the doc) - shallow-
// merged under whatever IS in Firestore, so it degrades to inert/default
// behavior rather than throwing.
const DEFAULT_CONFIG: MailchimpConfig = {
  enabled: false,
  audienceId: "",
  serverPrefix: undefined,
  defaultSubscribeStatus: "pending",
  enableSourceTags: true,
  purchaseTag: "Store Customer",
  eventRegistrationTag: "Event Registrant",
};

const CONFIG_DOC_PATH = "integration_settings/mailchimp";

type MailchimpSource = "purchase" | "eventRegistration";

/**
 * Reads the live config doc, merged over DEFAULT_CONFIG. No caching - reads
 * fresh on every call, since this is a low-volume admin/store app and a
 * config change (in particular flipping Enabled off) should take effect
 * immediately rather than waiting out some cache TTL.
 * @return {Promise<MailchimpConfig>} The effective config to use.
 */
async function getMailchimpConfig(): Promise<MailchimpConfig> {
  const snap = await admin.firestore().doc(CONFIG_DOC_PATH).get();
  return {...DEFAULT_CONFIG, ...(snap.exists ? snap.data() : {})};
}

interface SyncableCustomer {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: {number?: string};
  shippingAddress?: {
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedClient: {key: string; client: any} | undefined;

/**
 * Lazily builds (and caches, per apiKey+serverPrefix pair) the Mailchimp SDK
 * client. Untyped (like stripe.functions.ts's require("stripe")(...)) -
 * this SDK ships no bundled TypeScript types.
 * @param {string | undefined} serverPrefix Datacenter override from config;
 * falls back to parsing it off the API key's "-usXX" suffix.
 * @return {unknown} Configured client.
 */
function getMailchimpClient(serverPrefix?: string) {
  const apiKey = process.env.MAILCHIMP_API_KEY ?? "";
  const server = serverPrefix || apiKey.split("-").pop();
  const cacheKey = `${apiKey}:${server}`;
  if (cachedClient?.key === cacheKey) {
    return cachedClient.client;
  }
  const client = require("@mailchimp/mailchimp_marketing");
  client.setConfig({apiKey, server});
  cachedClient = {key: cacheKey, client};
  return client;
}

/**
 * Mailchimp identifies a list member by the MD5 hash of their lowercased
 * email - this is that hash, not a secret/security hash of any kind.
 * @param {string} email Already-lowercased, trimmed email address.
 * @return {string} Mailchimp subscriber hash.
 */
function subscriberHash(email: string): string {
  return crypto.createHash("md5").update(email).digest("hex");
}

/**
 * Upserts one customer into the configured Mailchimp audience. Uses
 * status_if_new rather than status so an existing member's subscribe status
 * (in particular unsubscribed/cleaned) is never overwritten by a later sync
 * from this app. Swallows all errors - a Mailchimp outage or bad request
 * must not fail the Firestore trigger this rides on.
 * @param {SyncableCustomer} customer Customer fields to sync.
 * @return {Promise<void>} Resolves once the attempt (successful or not) is
 * done.
 */
export async function upsertMailchimpMember(
  customer: SyncableCustomer
): Promise<void> {
  const config = await getMailchimpConfig();
  if (!config.enabled) {
    return;
  }
  const email = (customer.email ?? "").trim().toLowerCase();
  if (!isPlausibleEmail(email)) {
    return;
  }
  if (!config.audienceId) {
    console.warn(
      "Mailchimp sync enabled but audienceId is not set - skipping."
    );
    return;
  }

  const address = customer.shippingAddress;
  try {
    const mailchimp = getMailchimpClient(config.serverPrefix);
    await mailchimp.lists.setListMember(
      config.audienceId,
      subscriberHash(email),
      {
        email_address: email,
        status_if_new: config.defaultSubscribeStatus,
        merge_fields: {
          FNAME: customer.firstName ?? "",
          LNAME: customer.lastName ?? "",
          PHONE: customer.phone?.number ?? "",
          ...(address?.address1 ? {
            ADDRESS: {
              addr1: address.address1,
              addr2: address.address2 ?? "",
              city: address.city ?? "",
              state: address.state ?? "",
              zip: address.zip ?? "",
              country: address.country ?? "",
            },
          } : {}),
        },
      }
    );
  } catch (err) {
    console.error(`Mailchimp sync failed for ${email}:`, err);
  }
}

/**
 * Adds one acquisition-source tag to a Mailchimp member, additively (doesn't
 * touch any other tag already on the member) - so a customer who both
 * purchased and registered for an event ends up with both tags. Called
 * directly from customer-upsert.functions.ts and
 * event-registration-customer-upsert.functions.ts, the only two places that
 * know why a given customer exists. Swallows all errors, same reasoning as
 * upsertMailchimpMember.
 * @param {string} rawEmail Customer email (any casing/whitespace).
 * @param {MailchimpSource} source Which upsert trigger is calling.
 * @return {Promise<void>} Resolves once the attempt (successful or not) is
 * done.
 */
export async function addMailchimpSourceTag(
  rawEmail: string,
  source: MailchimpSource
): Promise<void> {
  const config = await getMailchimpConfig();
  if (!config.enabled || !config.enableSourceTags) {
    return;
  }
  const email = rawEmail.trim().toLowerCase();
  if (!isPlausibleEmail(email)) {
    return;
  }
  if (!config.audienceId) {
    return;
  }

  const tagName = source === "purchase" ?
    config.purchaseTag : config.eventRegistrationTag;
  try {
    const mailchimp = getMailchimpClient(config.serverPrefix);
    await mailchimp.lists.updateListMemberTags(
      config.audienceId,
      subscriberHash(email),
      {tags: [{name: tagName, status: "active"}]}
    );
  } catch (err) {
    console.error(`Mailchimp tag sync failed for ${email}:`, err);
  }
}

export const onCustomerCreatedMailchimpSync = onDocumentCreated(
  {document: "customers/{id}", secrets: ["MAILCHIMP_API_KEY"]},
  async (event) => {
    const data = event.data?.data();
    if (!data) {
      return;
    }
    await upsertMailchimpMember(data as SyncableCustomer);
  }
);

/**
 * The exact subset of a customer doc that upsertMailchimpMember pushes to
 * Mailchimp, normalized the same way it is at send time. Used to decide
 * whether an update is worth a sync (see onCustomerUpdatedMailchimpSync).
 * @param {SyncableCustomer} c The customer doc to reduce.
 * @return {Record<string, unknown>} The comparable field subset.
 */
function mailchimpFields(c: SyncableCustomer): Record<string, unknown> {
  return {
    email: (c.email ?? "").trim().toLowerCase(),
    firstName: c.firstName ?? "",
    lastName: c.lastName ?? "",
    phone: c.phone?.number ?? "",
    address1: c.shippingAddress?.address1 ?? "",
    address2: c.shippingAddress?.address2 ?? "",
    city: c.shippingAddress?.city ?? "",
    state: c.shippingAddress?.state ?? "",
    zip: c.shippingAddress?.zip ?? "",
    country: c.shippingAddress?.country ?? "",
  };
}

export const onCustomerUpdatedMailchimpSync = onDocumentUpdated(
  {document: "customers/{id}", secrets: ["MAILCHIMP_API_KEY"]},
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after) {
      return;
    }
    // Only sync when a field Mailchimp actually receives changed. Other
    // triggers write to customers docs constantly (pendingChanges appends,
    // subscription-flag flips, newRecordStatus) - none of which Mailchimp
    // gets - and each of those would otherwise cost a config read + a
    // Mailchimp API call for nothing (P13).
    if (before &&
      JSON.stringify(mailchimpFields(before as SyncableCustomer)) ===
      JSON.stringify(mailchimpFields(after as SyncableCustomer))) {
      return;
    }
    await upsertMailchimpMember(after as SyncableCustomer);
  }
);
