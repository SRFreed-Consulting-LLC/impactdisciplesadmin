// The JS-side mirror of the shared TypeScript tenancy seam
// (src/common/src/shared/lists/tenancy.ts).
//
// A DUPLICATE, DELIBERATELY. `scripts/` is plain Node run straight from
// source with no build step, so it cannot import the submodule's TypeScript.
// The alternative - every script hard-coding "tenants/impactdisciples.com/x"
// - is what this replaces, and it is worse: a path typed in fourteen places
// is a path that will be wrong in one of them.
//
// WHY GETTING THIS WRONG IS WORSE HERE THAN IN THE APPS. A screen reading the
// wrong collection renders empty and somebody notices within a minute. A
// SCRIPT reading the wrong collection reports "0 documents, nothing to do"
// and exits zero - it looks exactly like success. `optimise-page-images.js`
// would have compressed nothing and said so cheerfully.
//
// Keep in step with tenancy.ts. Its spec pins the list on that side; the
// mismatch check below is this side's half.

/** The one tenant. Reads as a domain, is deliberately not used as one. */
const TENANT_ID = "impactdisciples.com";

/** The collections that live under the tenant. Mirror of TENANT_COLLECTIONS. */
const TENANT_COLLECTIONS = [
  // Wave 0
  "page_content",
  "site_navigation",
  "site_footer",
  "dock_bar",
  "config",
  "testimonials",
  "impact_team",
  "dmms",
  "faq",
  // Wave 1 - reference data
  "commonTranslations",
  "titleTranslations",
  "coaches",
  "organizations",
  "locations",
  "product_categories",
  "series",
  "product_tags",
  "forms",
  "bulkDiscountTiers",
  "subtemplates",
  "popup_templates",
  "appConfig",
  "lessonTemplates",
  // Wave 2 - business data functions read and write, but no trigger watches.
  // libraryUsers / discussionGroups / groupLicenses / groupInvites are held
  // back to Wave 3: they are named inside firestore.rules HELPER functions,
  // not just match blocks.
  "customers",
  "tag_applications",
  "tag_rules",
  "affilliate_sales",
  "campaign_emails",
  "campaigns",
  "campaign_events",
  "campaign_sends",
  "campaign_offers",
  "campaign_popups",
  "log-messages",
  "activityLog",
  "adminMessages",
  "tax_rate_summaries",
  "shipping-labels",
  "shipping-label-batches",
  "products",
  "coupons",
  "pending_orders",
  "events",
  "lessonImages",
  // Wave 3 - trigger-backed and rules-entangled. These are the ones with
  // SUBCOLLECTIONS, which is why the migration tool had to learn to recurse.
  "purchases",
  "event-registrations",
  "admin_users",
  "eventSessionCounts",
  "mail_templates",
  "event-announcements",
  "groupLicenses",
  "groupInvites",
  "libraryUsers",
  "discussionGroups",
  "librarySeries",
  // Wave 4 - production-only and live
  // Wave 4 - production-only. email_lists is deliberately absent: no rule,
  // no reader, no writer - a leftover of the removed saved-lists feature.
  "form_submissions",

  // The public reader map's derived document - see the TypeScript source.
  "library_map",
];

/**
 * Where a collection actually lives.
 * @param {string} table The collection name.
 * @return {string} Its real path: nested for a tenant collection, unchanged
 *   otherwise.
 */
function tenantPath(table) {
  return TENANT_COLLECTIONS.includes(table) ?
    `tenants/${TENANT_ID}/${table}` :
    table;
}

/**
 * A collection reference at the right path, for a script that would
 * otherwise write `db.collection("page_content")`.
 * @param {object} db A Firestore instance.
 * @param {string} table The collection name.
 * @return {object} The collection reference.
 */
function tenantCollection(db, table) {
  return db.collection(tenantPath(table));
}

module.exports = {
  TENANT_ID,
  TENANT_COLLECTIONS,
  tenantPath,
  tenantCollection,
};
