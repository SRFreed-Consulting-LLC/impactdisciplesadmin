/* eslint-disable @typescript-eslint/no-var-requires */
// Every other file in this codebase (admin-users.functions.ts, utils/
// security.functions.ts, new-record-alerts.functions.ts, ...) calls
// admin.firestore()/admin.auth() directly without ever calling
// initializeApp() itself - they all rely on SOME module in the require
// chain having done it first. That used to be notifications.functions.ts
// (removed - the push-notification feature it backed is gone), so this is
// now that one shared init, done here at the true entry point rather than
// tucked inside an unrelated feature file where the next person to delete
// that feature could break every other function again without realizing
// why.
const admin = require("firebase-admin");
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});
// The Admin SDK throws on any `undefined` field value by default (e.g. an
// optional CheckoutForm field like billingAddress/phone genuinely absent
// from a request) rather than just omitting it - paypal.functions.ts hit
// this writing a Purchase doc built from a partially-filled request. Set
// once, here, before any function's first admin.firestore() call.
admin.firestore().settings({ignoreUndefinedProperties: true});

const stripe = require("./stripe.functions");
exports.create_payment_intent = stripe.create_payment_intent;
exports.cancel_payment_intent = stripe.cancel_payment_intent;
exports.refund_payment = stripe.refund_payment;

const shipping = require("./shipping.functions");
exports.get_shipping_rates = shipping.get_shipping_rates;
exports.get_shipping_label = shipping.get_shipping_label;

const paypal = require("./paypal.functions");
exports.create_paypal_order = paypal.create_paypal_order;
exports.capture_paypal_order = paypal.capture_paypal_order;

const subscriptions = require("./subscriptions.functions");
exports.subscribe_to_email_list = subscriptions.subscribe_to_email_list;
exports.unsubscribe_from_email_list = subscriptions.unsubscribe_from_email_list;

const youtube = require("./youtube.functions");
exports.get_youtube_videos = youtube.get_youtube_videos;
exports.get_youtube_videos_public = youtube.get_youtube_videos_public;

const adminUsers = require("./admin-users.functions");
exports.createAdminUser = adminUsers.createAdminUser;
exports.deleteAdminUser = adminUsers.deleteAdminUser;

const alerts = require("./new-record-alerts.functions");
exports.onEventRegistrationCreated = alerts.onEventRegistrationCreated;
exports.onEventRegistrationUpdated = alerts.onEventRegistrationUpdated;
exports.onFormSubmissionCreated = alerts.onFormSubmissionCreated;
exports.onFormSubmissionUpdated = alerts.onFormSubmissionUpdated;
exports.onPurchaseCreated = alerts.onPurchaseCreated;
exports.onPurchaseUpdated = alerts.onPurchaseUpdated;

const fulfillment = require("./purchase-fulfillment.functions");
exports.onPurchaseFulfillmentEligible =
  fulfillment.onPurchaseFulfillmentEligible;

const customerUpsert = require("./customer-upsert.functions");
exports.onPurchaseCustomerUpsert = customerUpsert.onPurchaseCustomerUpsert;

const eventRegCustomerUpsert =
  require("./event-registration-customer-upsert.functions");
exports.onEventRegistrationCustomerUpsert =
  eventRegCustomerUpsert.onEventRegistrationCustomerUpsert;

// Customer tag rules (Campaigns Manager > Tag Rules): the live tagging
// rides the two upsert triggers above; this callable is the admin-triggered
// retroactive sweep for one rule across historic purchases/registrations.
const tagRules = require("./tag-rules.functions");
exports.applyTagRuleRetroactively = tagRules.applyTagRuleRetroactively;

// Campaign Manager v2's unified send engine (Phase 2): every campaign
// email - send-now, scheduled, or tag-triggered - flows through one
// server-side path with a per-recipient ledger. campaignSendScheduler is
// this repo's first scheduled function (initial deploy enables the Cloud
// Scheduler API and creates the job); it replaces the never-deployed
// autoCampaignScheduler.
const campaignSend = require("./campaign-send.functions");
exports.enqueueCampaignEmail = campaignSend.enqueueCampaignEmail;
exports.previewCampaignAudience = campaignSend.previewCampaignAudience;
exports.sendCampaignTestEmail = campaignSend.sendCampaignTestEmail;
exports.campaignSendScheduler = campaignSend.campaignSendScheduler;
exports.onCampaignMailDelivered = campaignSend.onCampaignMailDelivered;

// Sweep 2026-08-17: language registry backs the reader's language picker
// so translation docs no longer need an open collection-group read.
const languageRegistry = require("./library-language-registry.functions");
exports.onTranslationLocaleRegistry =
  languageRegistry.onTranslationLocaleRegistry;
exports.rebuildLanguageRegistry = languageRegistry.rebuildLanguageRegistry;

const libraryLicenseGrant = require("./library-license-grant.functions");
exports.onPurchaseGrantLibraryLicenses =
  libraryLicenseGrant.onPurchaseGrantLibraryLicenses;

const bookImport = require("./book-import.functions");
exports.importBookFromPdf = bookImport.importBookFromPdf;

// Pre-prod #6: refund + revoke-on-refund (admin's choice at refund time)
// and the manual store-license revoke tool.
const storeRefund = require("./store-refund.functions");
exports.refundStorePurchase = storeRefund.refundStorePurchase;
exports.revokeStorePurchasedLicense = storeRefund.revokeStorePurchasedLicense;

const libraryUsers = require("./library-users.functions");
exports.updateLibraryUser = libraryUsers.updateLibraryUser;
exports.setLibraryUserRevoked = libraryUsers.setLibraryUserRevoked;
exports.grantLibraryUserLicenses = libraryUsers.grantLibraryUserLicenses;
exports.revokeAdminGrantedLicense = libraryUsers.revokeAdminGrantedLicense;
exports.sendLibraryUserMessage = libraryUsers.sendLibraryUserMessage;

// Phase 2 Slice 6: every remaining Cloud Function moved out of the
// standalone impact-discipleship-library-manager-new project, per the
// consolidation plan - see that repo's own memory for the full inventory
// this closes out.
const libraryGroupLicenses = require("./library-group-licenses.functions");
exports.purchaseGroupLicenses = libraryGroupLicenses.purchaseGroupLicenses;
exports.assignGroupLicense = libraryGroupLicenses.assignGroupLicense;
exports.revokeGroupLicense = libraryGroupLicenses.revokeGroupLicense;
exports.leaveGroupAndRevokeLicense =
  libraryGroupLicenses.leaveGroupAndRevokeLicense;
exports.copyGroupMembers = libraryGroupLicenses.copyGroupMembers;
exports.getInviteDetails = libraryGroupLicenses.getInviteDetails;
exports.declineGroupInvite = libraryGroupLicenses.declineGroupInvite;
exports.acceptGroupInvite = libraryGroupLicenses.acceptGroupInvite;

const libraryGroupNotifications =
  require("./library-group-notifications.functions");
exports.notifyGroupChatMessage =
  libraryGroupNotifications.notifyGroupChatMessage;
exports.notifyConversationMessage =
  libraryGroupNotifications.notifyConversationMessage;
exports.onGroupMembershipCountChanged =
  libraryGroupNotifications.onGroupMembershipCountChanged;
exports.notifyJoinRequestActivity =
  libraryGroupNotifications.notifyJoinRequestActivity;
exports.notifyPrayerRequestShared =
  libraryGroupNotifications.notifyPrayerRequestShared;

// revokePurchase and the 4 legacy staff functions (bootstrapFirstAdmin/
// createUser/linkExistingUser/deleteUser) were retired 2026-08-17 along
// with the named 'impactdiscipleship-books' database they operated on -
// library purchases are no longer recorded at all (the web store's own
// `purchases` is the system of record), and the old manager app's
// adminUsers staff model is dead per the consolidation plan.
// grantStorePurchaseLicenses (the shared-secret HTTP bridge) was retired
// in Phase 4, 2026-08-17 - onPurchaseGrantLibraryLicenses grants directly
// in-process now; see library-license-grant.functions.ts.
const libraryPurchases = require("./library-purchases.functions");
exports.verifyAndGrantReaderStorePurchase =
  libraryPurchases.verifyAndGrantReaderStorePurchase;

const libraryAccount = require("./library-account.functions");
exports.deleteMyAccount = libraryAccount.deleteMyAccount;

const libraryProfile = require("./library-profile.functions");
exports.recordMyLogin = libraryProfile.recordMyLogin;
exports.createMyReaderProfile = libraryProfile.createMyReaderProfile;
exports.updateMyPreferences = libraryProfile.updateMyPreferences;

const adminClaims = require("./admin-claims.functions");
exports.onAdminUserRoleSync = adminClaims.onAdminUserRoleSync;

const checkoutSupport = require("./checkout-support.functions");
exports.lookup_coupon = checkoutSupport.lookupCouponHttp;
exports.lookupCoupon = checkoutSupport.lookupCoupon;
exports.onPurchaseTaxSummary = checkoutSupport.onPurchaseTaxSummary;

// Pre-prod #2: the public event-registration flows (snake_case exports =
// the web app's fetch()-style onRequest convention).
const eventRegistration = require("./event-registration.functions");
exports.register_for_event = eventRegistration.registerForEventHttp;
exports.get_event_registration = eventRegistration.getEventRegistrationHttp;
exports.update_my_sessions = eventRegistration.updateMySessionsHttp;
exports.check_registration_exists =
  eventRegistration.checkRegistrationExistsHttp;
exports.get_session_counts = eventRegistration.getSessionCountsHttp;
exports.onEventRegistrationSessionCounts =
  eventRegistration.onEventRegistrationSessionCounts;

const libraryGroups = require("./library-groups.functions");
exports.createGroup = libraryGroups.createGroup;
exports.requestToJoinGroup = libraryGroups.requestToJoinGroup;
exports.approveGroupMembership = libraryGroups.approveGroupMembership;
exports.rejectGroupMembership = libraryGroups.rejectGroupMembership;
exports.closeMyGroup = libraryGroups.closeMyGroup;
exports.sendGroupInvite = libraryGroups.sendGroupInvite;
exports.cancelGroupInvite = libraryGroups.cancelGroupInvite;

const mailchimpSync = require("./mailchimp-sync.functions");
exports.onCustomerCreatedMailchimpSync =
  mailchimpSync.onCustomerCreatedMailchimpSync;
exports.onCustomerUpdatedMailchimpSync =
  mailchimpSync.onCustomerUpdatedMailchimpSync;
