/* eslint-disable @typescript-eslint/no-var-requires */
import * as functions from "firebase-functions";
import {restrictedCors, requireStaffAuth} from "./utils/security.functions";

let stripe;

exports.create_payment_intent = functions
  .runWith({secrets: ["STRIPE_SECRET_KEY"]})
  .https.onRequest((request, response) => {
    return restrictedCors(request, response, async () => {
      stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

      let total = 0;

      try {
        request.body.items.forEach((item) => {
          total += item.amount;
        });

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
        response.send({
          code: 400,
          body: request.body,
          error: err,
        });
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
        response.send({
          code: 400,
          body: request.body,
          error: err,
        });
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
        response.send({
          code: 400,
          body: request.body,
          error: err,
        });
      }
    });
  });
