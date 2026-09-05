import {createHmac, timingSafeEqual} from "node:crypto";

/**
 * Per-recipient unsubscribe tokens.
 *
 * An unsubscribe link has to work for someone with no account, so the
 * endpoint cannot ask for a login - and until 2026-09-05 it asked for
 * nothing at all: `?email=x&type=newsletter` unsubscribed x, whoever sent
 * the request. Anyone could remove anyone from the newsletter with one GET,
 * a whole list with a loop.
 *
 * The token is an HMAC of the recipient's address and the list, under a
 * secret only the functions hold (UNSUBSCRIBE_TOKEN_SECRET). It proves the
 * link came from an email WE sent to THAT address, which is exactly the
 * claim an unsubscribe makes. Nothing is stored per recipient.
 *
 * Links sent before this existed carry no token. They are honoured until
 * LEGACY_UNSUBSCRIBE_LINKS_UNTIL - a month, so every email in flight keeps
 * a working opt-out (a dead unsubscribe link is a CAN-SPAM problem, not a
 * cosmetic one) - and refused after it.
 */

/** 2026-10-06 00:00 UTC. Untokened links are refused from here on. */
export const LEGACY_UNSUBSCRIBE_LINKS_UNTIL = Date.UTC(2026, 9, 6);

const TOKEN_LENGTH = 32;
const TOKEN_SHAPE = /^[0-9a-f]{32}$/;

/**
 * @param {string} email The recipient's address (any case; normalised).
 * @param {string} type The list - "newsletter" or "prayer".
 * @param {string} secret UNSUBSCRIBE_TOKEN_SECRET's value.
 * @return {string} 32 hex characters.
 */
export function unsubscribeToken(
  email: string,
  type: string,
  secret: string
): string {
  return createHmac("sha256", secret)
    .update(`${email.trim().toLowerCase()}|${type}`)
    .digest("hex")
    .slice(0, TOKEN_LENGTH);
}

/**
 * Constant-time check of a presented token.
 * @param {string} email The address in the link.
 * @param {string} type The list in the link.
 * @param {unknown} token The token in the link.
 * @param {string} secret UNSUBSCRIBE_TOKEN_SECRET's value.
 * @return {boolean} Whether the token is the one we would have issued.
 */
export function verifyUnsubscribeToken(
  email: string,
  type: string,
  token: unknown,
  secret: string
): boolean {
  if (typeof token !== "string" || !TOKEN_SHAPE.test(token)) {
    return false;
  }
  const expected = unsubscribeToken(email, type, secret);
  return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

/**
 * @param {number} now The clock, injectable for tests.
 * @return {boolean} Whether an untokened link is still accepted.
 */
export function legacyLinksStillHonoured(now = Date.now()): boolean {
  return now < LEGACY_UNSUBSCRIBE_LINKS_UNTIL;
}
