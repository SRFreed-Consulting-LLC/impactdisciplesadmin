/* eslint-disable @typescript-eslint/no-var-requires */
import * as functions from "firebase-functions";
import {restrictedCors, requireStaffAuth} from "./utils/security.functions";

let stripe;

// Stripe's `amount` is the smallest currency unit (cents for USD), an
// integer. This function has no product/event to look up server-side to
// verify a donation amount against (unlike store checkout's
// computeOrderPricing) -- the donor's own chosen amount genuinely *is*
// the correct amount. What it's missing is sanity bounds: today nothing
// stops a negative, zero, non-numeric, or absurd value reaching Stripe
// (this endpoint's only current caller, give.component.ts, has no
// client-side validation either -- see its own "TODO: validate give
// forms"). $1-$1,000,000 is a generous sanity ceiling, not a real
// business limit -- it exists to reject clearly malformed/abusive input,
// not to constrain a legitimate large gift.
const MIN_DONATION_CENTS = 100;
const MAX_DONATION_CENTS = 100_000_000;

exports.create_payment_intent = functions
  .runWith({secrets: ["STRIPE_SECRET_KEY"]})
  .https.onRequest((request, response) => {
    return restrictedCors(request, response, async () => {
      stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

      let total = 0;

      try {
        if (!Array.isArray(request.body.items) ||
            request.body.items.length === 0) {
          response.status(400).send({code: 400, error: "items is required"});
          return;
        }

        request.body.items.forEach((item) => {
          total += item.amount;
        });

        if (
          !Number.isInteger(total) ||
          total < MIN_DONATION_CENTS ||
          total > MAX_DONATION_CENTS
        ) {
          response.status(400).send({code: 400, error: "Invalid amount"});
          return;
        }

        const paymentIntent = await stripe.paymentIntents.create({
          amount: total,
          currency: "usd",
          automatic_payment_methods: {
            enabled: true,
          },
          description: request.body.description,
          receipt_email: request.body.receipt_email,
          expand: ["latest_charge"],
        });

        response.send({
          clientSecret: paymentIntent.client_secret,
          paymentIntent: paymentIntent.id,
        });
      } catch (err) {
        console.error("create_payment_intent failed", err);
        response.status(400).send(
          {code: 400, error: "Unable to create payment"});
      }
    });
  });


exports.cancel_payment_intent = functions
  .runWith({secrets: ["STRIPE_SECRET_KEY"]})
  .https.onRequest((request, response) => {
    return restrictedCors(request, response, async () => {
      stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

      try {
        await stripe.paymentIntents.cancel(request.body.paymentIntent);

        response.send({
          id: request.body,
        });
      } catch (err) {
        console.error("cancel_payment_intent failed", err);
        response.status(400).send(
          {code: 400, error: "Unable to cancel payment"});
      }
    });
  });

exports.refund_payment = functions
  .runWith({secrets: ["STRIPE_SECRET_KEY"]})
  .https.onRequest((request, response) => {
    return restrictedCors(request, response, async () => {
      // Refunds move real money -- only recognized staff (admin app,
      // real Firebase Auth session) may call this.
      try {
        await requireStaffAuth(request);
      } catch (err) {
        response.status(401).send({code: 401, error: "Unauthorized"});
        return;
      }

      stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

      try {
        const refund = await stripe.refunds.create({
          payment_intent: request.body.paymentIntent,
          amount: request.body.amount,
        });

        response.send(refund);
      } catch (err) {
        console.error("refund_payment failed", err);
        response.status(400).send(
          {code: 400, error: "Unable to process refund"});
      }
    });
  });
