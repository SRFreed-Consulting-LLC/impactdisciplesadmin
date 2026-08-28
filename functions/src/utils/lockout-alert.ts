// Pure decision core for the locked-out-patron alert, kept free of Firestore/
// Auth so it unit-tests without an emulator (same "pure export tested via
// ../lib" pattern as campaign-pure.test.js). The I/O wrapper lives in
// library-lockout-alert.functions.ts.
//
// "Locked out" = a libraryUsers profile whose email has NO Firebase Auth
// account, so the person cannot sign in even though their books, lesson
// answers and highlights exist. See the 2026-08-28 investigation: a legacy
// migration carried Firestore data but not credentials, leaving 77 of 101
// prod profiles unable to log in, discovered only when one phoned in.

/** Weekly re-reminder while a backlog persists and nothing new fired a send. */
export const HEARTBEAT_MS = 7 * 24 * 60 * 60 * 1000;

/** The default recipient when web-config's lockedOutAlertEmail is blank. */
export const DEFAULT_ALERT_EMAIL = "shane.freed@gmail.com";

/** Non-person accounts that are locked out by construction and must never
 *  trigger an alert (e.g. the Google Play account-creation test artifact). */
export const ALERT_EXCLUDE = new Set<string>(["app_access@google.com"]);

export interface LockoutState {
  /** Emails already accounted for (the baseline). Absent on the first run. */
  known?: string[];
  /** When any alert (new-batch or heartbeat) was last sent. */
  lastAlertAt?: number;
}

export interface LockoutDecision {
  /** Persist this back as the new state. */
  nextState: LockoutState;
  /** The email to send, or null to stay silent this run. */
  email:
    | {
        kind: "new" | "heartbeat";
        /** Populated for kind 'new'. */
        newlyLockedOut: string[];
        /** Full current locked-out set (both kinds). */
        allLockedOut: string[];
      }
    | null;
}

/** Normalize + de-dupe + sort a list of emails. */
export function normalizeEmails(emails: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const e of emails) {
    const v = (e || "").trim().toLowerCase();
    if (v) out.add(v);
  }
  return [...out].sort();
}

/**
 * Locked-out set = libraryUsers emails with no matching Auth account, minus
 * the known non-person exclusions.
 * @param {Iterable<string>} libraryUserEmails libraryUsers doc ids (emails).
 * @param {Iterable<string>} authEmails all Firebase Auth account emails.
 * @return {string[]} normalized, sorted locked-out emails.
 */
export function computeLockedOut(
  libraryUserEmails: Iterable<string>,
  authEmails: Iterable<string>,
): string[] {
  const auth = new Set(normalizeEmails(authEmails));
  return normalizeEmails(libraryUserEmails).filter(
    (e) => !auth.has(e) && !ALERT_EXCLUDE.has(e),
  );
}

/**
 * Decide whether this run emails. Rules (Shane 2026-08-28): the first run
 * establishes a SILENT baseline (never blast the existing backlog); after
 * that, email only when a NEW locked-out email appears; plus a weekly
 * heartbeat if a backlog remains and nothing new has fired a send.
 * @param {string[]} currentLockedOut locked-out emails right now.
 * @param {LockoutState|undefined} prev previously-persisted state.
 * @param {number} now Date.now().
 * @return {LockoutDecision} what to persist and whether to email.
 */
export function decideLockoutAlert(
  currentLockedOut: string[],
  prev: LockoutState | undefined,
  now: number,
): LockoutDecision {
  const current = normalizeEmails(currentLockedOut);

  // First run: baseline silently so the existing backlog is never blasted.
  if (!prev || !prev.known) {
    return {
      nextState: {known: current, lastAlertAt: prev?.lastAlertAt},
      email: null,
    };
  }

  const knownSet = new Set(prev.known);
  const newly = current.filter((e) => !knownSet.has(e));

  if (newly.length > 0) {
    return {
      nextState: {known: current, lastAlertAt: now},
      email: {kind: "new", newlyLockedOut: newly, allLockedOut: current},
    };
  }

  const dueForHeartbeat =
    current.length > 0 &&
    (prev.lastAlertAt === undefined || now - prev.lastAlertAt >= HEARTBEAT_MS);
  if (dueForHeartbeat) {
    return {
      nextState: {known: current, lastAlertAt: now},
      email: {kind: "heartbeat", newlyLockedOut: [], allLockedOut: current},
    };
  }

  // Quiet run: still refresh the known set (resolved people drop out; a
  // relapse would re-alert), send nothing, keep the heartbeat clock.
  return {
    nextState: {known: current, lastAlertAt: prev.lastAlertAt},
    email: null,
  };
}

/**
 * Parse the configured recipient string (comma/semicolon-separated) into a
 * clean list, falling back to the default when blank/invalid.
 * @param {string|undefined|null} raw web-config lockedOutAlertEmail value.
 * @return {string[]} one or more recipient addresses.
 */
export function resolveRecipients(raw: string | undefined | null): string[] {
  const parts = (raw || "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
  return parts.length ? parts : [DEFAULT_ALERT_EMAIL];
}
