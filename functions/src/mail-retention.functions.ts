import {onSchedule} from "firebase-functions/v2/scheduler";
import {Timestamp, getFirestore} from "firebase-admin/firestore";

/**
 * Keeps the `mail` collection from growing forever.
 *
 * WHY THIS EXISTS. `mail` is the Trigger Email extension's queue: the app
 * writes a document, the extension sends it and stamps `delivery`, and then
 * nothing ever clears it. On 2026-09-01 production held 7,792 documents -
 * each carrying its full message body - with the oldest delivered in
 * September 2024. It was the only collection in either project growing
 * without limit. A one-off prune took it to 636; this stops it coming back.
 *
 * WHAT IT DELETES, and nothing else:
 *   - `delivery.state === "SUCCESS"`, so a failure is left where somebody
 *     can still look at it. 239 of those survived the first prune and are
 *     the only record that a message never arrived;
 *   - with a `delivery.endTime` older than KEEP_DAYS. No endTime means the
 *     extension has not finished with the document - a queued or in-flight
 *     message is invisible to this query and cannot be caught by it.
 *
 * The mail is not the record of anything. Campaign sends are tracked in
 * `campaign_emails` and `campaign_events`; transactional receipts live on
 * `purchases`. This is the delivery log.
 *
 * WHY NOT THE EXTENSION'S OWN TTL. firestore-send-email can stamp
 * `delivery.expireAt` itself (TTL_EXPIRE_TYPE / TTL_EXPIRE_VALUE, currently
 * "never"), which with a Firestore TTL policy would do the same job with no
 * code at all. It is the tidier answer and worth moving to - but turning it
 * on redeploys the extension that sends EVERY email the ministry sends, and
 * its SMTP password is a secret reference. That is a change to make
 * deliberately, watching it, not as a side effect of a cleanup. This runs
 * entirely inside our own deploy pipeline instead.
 *
 * NOTE for whoever does move to the extension's TTL: the field is
 * `delivery.expireAt`, NOT `delivery.endTime`. A TTL policy deletes when the
 * field's timestamp is in the PAST, and endTime is always in the past the
 * moment a message is delivered - pointing a policy at it would empty the
 * collection immediately.
 */

/** How much delivery history to keep. Three months covers "did that go out
 *  last quarter?" without holding years of message bodies. */
const KEEP_DAYS = 90;

/** Firestore's own per-commit ceiling is 500; this leaves headroom. */
const BATCH = 400;

/** Bounded per run so one tick cannot spend an unbounded amount of time on
 *  a backlog - it simply carries on the next night. */
const MAX_PER_RUN = 5000;

export const pruneSentMail = onSchedule(
  {
    schedule: "every day 03:30",
    timeZone: "America/New_York",
    timeoutSeconds: 540,
  },
  async () => {
    const db = getFirestore();
    const cutoff = Timestamp.fromMillis(
      Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000
    );

    const snap = await db.collection("mail")
      .where("delivery.endTime", "<", cutoff)
      .limit(MAX_PER_RUN)
      .get();

    // The query cannot express "and state is SUCCESS" without a composite
    // index, and the filter is cheap - so it is applied here. A failed send
    // is kept however old it is.
    const doomed = snap.docs.filter(
      (d) => d.get("delivery.state") === "SUCCESS"
    );

    if (!doomed.length) {
      const before = cutoff.toDate().toISOString().slice(0, 10);
      console.log(`pruneSentMail: nothing delivered before ${before}`);
      return;
    }

    for (let i = 0; i < doomed.length; i += BATCH) {
      const batch = db.batch();
      doomed.slice(i, i + BATCH).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }

    console.log(
      `pruneSentMail: deleted ${doomed.length} delivered message(s) older ` +
      `than ${KEEP_DAYS} days; left ${snap.size - doomed.length} that did ` +
      "not succeed."
    );
  }
);
