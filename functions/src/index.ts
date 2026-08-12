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

const stripe = require("./stripe.functions");
exports.create_payment_intent = stripe.create_payment_intent;
exports.cancel_payment_intent = stripe.cancel_payment_intent;
exports.refund_payment = stripe.refund_payment;

const shipping = require("./shipping.functions");
exports.get_shipping_rates = shipping.get_shipping_rates;
exports.get_shipping_label = shipping.get_shipping_label;

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

const fulfillment = require("./purchase-fulfillment.functions");
exports.onPurchaseFulfillmentEligible =
  fulfillment.onPurchaseFulfillmentEligible;
