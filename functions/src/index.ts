/* eslint-disable @typescript-eslint/no-var-requires */
const stripe = require("./stripe.functions");
exports.create_payment_intent = stripe.create_payment_intent;
exports.cancel_payment_intent = stripe.cancel_payment_intent;
exports.refund_payment = stripe.refund_payment;

const notifications = require("./notifications.functions");
exports.notifications = notifications.sendNotification;

const shipping = require("./shipping.functions");
exports.get_shipping_rates = shipping.get_shipping_rates;
exports.get_shipping_label = shipping.get_shipping_label;

const importJSON = require("./import.functions");
exports.importJson = importJSON.importJSON;

const imageUploader = require("./fetchimage.functions");
exports.uploadImageToStorage = imageUploader.uploadImageToStorage;

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
