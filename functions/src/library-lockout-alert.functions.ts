import {tenantPath} from "./common/shared/lists/site_tenancy";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {getFirestore} from "firebase-admin/firestore";
import {getAuth} from "firebase-admin/auth";
import {queueMail} from "./transactional-emails";
import {
  computeLockedOut,
  decideLockoutAlert,
  resolveRecipients,
  LockoutState,
} from "./utils/lockout-alert";

// Daily watch for reader patrons who CANNOT sign in: a libraryUsers profile
// exists (books, lesson answers, highlights) but there is no Firebase Auth
// account for that email. This is the class that surfaced 2026-08-28 only
// because a patron phoned in - there was previously no visibility at all
// (errorLogs has no alerting, and a returning user on a stale app bundle
// never even logs a failure). See utils/lockout-alert.ts for the rules.
//
// Recipient comes from web-config (config.lockedOutAlertEmail), editable in
// the admin Content Manager -> Web Config screen; blank falls back to the
// hardcoded default. State (the baseline + last-alert time) lives in
// systemState/lockoutAlert - an Admin-SDK-only doc no client rule exposes.

const STATE_COLLECTION = "systemState";
const STATE_DOC = "lockoutAlert";

/** Every Firebase Auth account email, paged. */
async function listAllAuthEmails(): Promise<string[]> {
  const emails: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await getAuth().listUsers(1000, pageToken);
    for (const u of page.users) if (u.email) emails.push(u.email);
    pageToken = page.pageToken;
  } while (pageToken);
  return emails;
}

/** One list item per locked-out email, with its book-licence count. */
function itemsHtml(
  emails: string[],
  licenceCountByEmail: Map<string, number>,
): string {
  return emails
    .map((e) => {
      const lic = licenceCountByEmail.get(e) ?? 0;
      const suffix = lic ?
        ` &mdash; ${lic} book licence${lic === 1 ? "" : "s"}` :
        "";
      return "<li style=\"margin:0 0 4px;font:14px Arial,sans-serif;" +
        "color:#1f2937;\">" + e + suffix + "</li>";
    })
    .join("");
}

/** Minimal internal-ops alert markup (not a marketing email). */
function alertHtml(
  kind: "new" | "heartbeat",
  newly: string[],
  all: string[],
  licenceCountByEmail: Map<string, number>,
): string {
  const listed = kind === "new" ? newly : all;
  const heading = kind === "new" ?
    `${newly.length} new reader(s) cannot sign in` :
    `${all.length} reader(s) still cannot sign in`;
  const preface = kind === "new" ?
    "These reader(s) have a library profile (books, and any past lesson " +
      "answers or highlights) but no sign-in account, so they cannot log in:" :
    "Weekly reminder - these readers have a library profile but no " +
      "sign-in account and still cannot log in:";
  return "<div style=\"font:15px Arial,sans-serif;color:#1f2937;" +
    "max-width:600px;\">" +
    "<h2 style=\"font-size:18px;color:#111827;\">" + heading + "</h2>" +
    "<p style=\"line-height:1.6;\">" + preface + "</p>" +
    "<ul style=\"padding-left:20px;\">" +
    itemsHtml(listed, licenceCountByEmail) + "</ul>" +
    "<p style=\"line-height:1.6;color:#6b7280;font-size:14px;\">" +
    "To restore access, send each a sign-up link for the SAME email " +
    "address - their profile reattaches automatically on sign-up. " +
    "Total currently locked out: " + all.length + ".</p>" +
    "<p style=\"font-size:12px;color:#9ca3af;\">Automated daily check. " +
    "Change the recipient in Content Manager &rarr; Web Config &rarr; " +
    "Locked-out patron alert email.</p></div>";
}

export const lockedOutPatronAlert = onSchedule(
  {
    schedule: "every day 08:00",
    timeZone: "America/New_York",
    timeoutSeconds: 120,
  },
  async () => {
    const db = getFirestore();

    // libraryUsers ids are emails; capture licence counts from the same read.
    const [usersSnap, authEmails] = await Promise.all([
      db.collection("libraryUsers").get(),
      listAllAuthEmails(),
    ]);
    const licenceCountByEmail = new Map<string, number>();
    for (const d of usersSnap.docs) {
      const lic = (d.data().licensedBookIds as unknown[]) || [];
      const count = Array.isArray(lic) ? lic.length : 0;
      licenceCountByEmail.set(d.id.trim().toLowerCase(), count);
    }

    const currentLockedOut = computeLockedOut(
      usersSnap.docs.map((d) => d.id),
      authEmails,
    );

    const stateRef = db.collection(STATE_COLLECTION).doc(STATE_DOC);
    const stateSnap = await stateRef.get();
    const prev = stateSnap.exists ?
      (stateSnap.data() as LockoutState) :
      undefined;

    const decision = decideLockoutAlert(currentLockedOut, prev, Date.now());

    if (decision.email) {
      const configRef = db.collection(tenantPath("config"));
      const configSnap = await configRef.limit(1).get();
      const raw = configSnap.empty ?
        "" :
        ((configSnap.docs[0].data().lockedOutAlertEmail as
          | string
          | undefined) ?? "");
      const recipients = resolveRecipients(raw);

      const count = decision.email.kind === "new" ?
        decision.email.newlyLockedOut.length :
        decision.email.allLockedOut.length;
      const subject = decision.email.kind === "new" ?
        `[Library] ${count} new reader(s) cannot sign in` :
        `[Library] ${count} reader(s) still cannot sign in`;
      const html = alertHtml(
        decision.email.kind,
        decision.email.newlyLockedOut,
        decision.email.allLockedOut,
        licenceCountByEmail,
      );
      for (const to of recipients) {
        await queueMail(db, to, subject, html);
      }
      console.log(
        `lockedOutPatronAlert: sent ${decision.email.kind} alert to ` +
          `${recipients.join(", ")} (new=` +
          `${decision.email.newlyLockedOut.length}, total=` +
          `${decision.email.allLockedOut.length})`,
      );
    } else {
      console.log(
        "lockedOutPatronAlert: no email (current locked out=" +
          `${currentLockedOut.length}, ` +
          `${prev ? "baseline exists" : "baseline established"})`,
      );
    }

    await stateRef.set(decision.nextState, {merge: false});
  },
);
