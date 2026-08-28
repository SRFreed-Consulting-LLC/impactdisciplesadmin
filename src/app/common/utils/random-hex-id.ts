/**
 * A random lowercase-hex string of `length` characters.
 *
 * One definition, replacing five near-identical private copies found by the
 * 2026-08-27 sweep (P8): contact-details (8), logger.service's error code
 * (8), room.component (20), products.component (20), plus the two agenda
 * dialogs (13) which now use generateAgendaItemId() in session-block.util.ts
 * - that one keeps its own name because agenda item ids are a data contract
 * (EventRegistrationModel.trainingSessions references them) and the width
 * must not drift.
 *
 * The copies had all inherited the same UUID-v4 idiom -
 * `'xxxx'.replace(/[xy]/g, ...)` with a `(r & 0x3) | 0x8` branch for `y` -
 * from somewhere, but none of their templates contained a `y`, so that
 * branch was DEAD in every one of them. It is dropped here rather than
 * carried forward; this produces the same output the copies did.
 *
 * NOT cryptographically random and not collision-proof - Math.random is
 * fine for a client-side row key an admin is about to save, which is all
 * any caller uses it for. Do not use it for a token, an invite id, or
 * anything a person could guess their way into.
 * @param {number} length How many hex characters.
 * @return {string} The generated id.
 */
export function randomHexId(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ((Math.random() * 16) | 0).toString(16);
  }
  return out;
}
