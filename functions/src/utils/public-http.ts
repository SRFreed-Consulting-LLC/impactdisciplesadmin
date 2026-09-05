import {HttpsFunction, HttpsOptions, onRequest}
  from "firebase-functions/v2/https";
import * as functions from "firebase-functions";
import * as logger from "firebase-functions/logger";
import type {Response} from "express";
import {restrictedCors} from "./security.functions";

/** An onRequest handler body: the request and the express response. */
export type PublicHandler = (
  request: functions.https.Request,
  response: Response
) => Promise<void>;

export interface PublicHttpOptions extends HttpsOptions {
  /** Refuse any other verb with a 405 before the handler runs. */
  method?: "GET" | "POST";
}

/**
 * The method check and the catch-all that every public endpoint wants,
 * as a plain function so it can be tested with a fake request/response.
 *
 * The catch matters more than it looks. restrictedCors hands the handler
 * to the cors middleware's callback and cannot await it, so an exception
 * thrown from an async handler with no try/catch of its own used to become
 * an UNHANDLED REJECTION: nothing was sent, the request hung until the
 * function timed out, and the shopper saw a spinner rather than an error.
 * Five of the event-registration endpoints were in that state.
 *
 * @param {string} name The function's public name, for the log line.
 * @param {"GET"|"POST"|undefined} method The one verb allowed, if any.
 * @param {PublicHandler} handler The endpoint's own body.
 * @return {PublicHandler} The guarded handler.
 */
export function guardedHandler(
  name: string,
  method: "GET" | "POST" | undefined,
  handler: PublicHandler
): PublicHandler {
  return async (request, response) => {
    if (method && request.method !== method) {
      response.status(405).send({error: `${method} required.`});
      return;
    }
    try {
      await handler(request, response);
    } catch (err) {
      logger.error(`${name} failed`, err);
      if (!response.headersSent) {
        response.status(500).send({error: "Something went wrong"});
      }
    }
  };
}

/**
 * An anonymous, browser-called HTTP endpoint: onRequest + the CORS
 * allow-list + one verb + a catch-all 500. What eight endpoints wrote out
 * by hand, each slightly differently, until 2026-09-05.
 *
 * Not for staff-gated endpoints (requireStaffAuth inside) or the two PayPal
 * endpoints, which map their own failures to error codes the storefront
 * shows - those keep restrictedCors directly.
 *
 * @param {string} name The function's public name (the export name in
 * index.ts), for the failure log line.
 * @param {PublicHttpOptions} options onRequest options plus `method`.
 * @param {PublicHandler} handler The endpoint's own body.
 * @return {HttpsFunction} The function to export.
 */
export function publicHttp(
  name: string,
  options: PublicHttpOptions,
  handler: PublicHandler
): HttpsFunction {
  const {method, ...httpsOptions} = options;
  const guarded = guardedHandler(name, method, handler);
  return onRequest(httpsOptions, (request, response) => {
    return restrictedCors(
      request, response, () => guarded(request, response)
    );
  });
}
