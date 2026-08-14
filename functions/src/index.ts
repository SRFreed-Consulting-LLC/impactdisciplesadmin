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
exports.unsubscribe_from_email_list = subscriptions.unsubscribe_from_email_list;

const youtube = require("./youtube.functions");
exports.get_youtube_keys = youtube.get_youtube_keys;

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
exports.onSubscriptionCreated = alerts.onSubscriptionCreated;
exports.onSubscriptionUpdated = alerts.onSubscriptionUpdated;

const fulfillment = require("./purchase-fulfillment.functions");
exports.onPurchaseFulfillmentEligible =
  fulfillment.onPurchaseFulfillmentEligible;

const customerUpsert = require("./customer-upsert.functions");
exports.onPurchaseCustomerUpsert = customerUpsert.onPurchaseCustomerUpsert;

const eventRegCustomerUpsert =
  require("./event-registration-customer-upsert.functions");
exports.onEventRegistrationCustomerUpsert =
  eventRegCustomerUpsert.onEventRegistrationCustomerUpsert;

const mailchimpSync = require("./mailchimp-sync.functions");
exports.onCustomerCreatedMailchimpSync =
  mailchimpSync.onCustomerCreatedMailchimpSync;
exports.onCustomerUpdatedMailchimpSync =
  mailchimpSync.onCustomerUpdatedMailchimpSync;
