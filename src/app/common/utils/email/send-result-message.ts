import { EnqueueCampaignEmailResult } from '@impact-common/shared/contract/admin-callables.types';

// What an admin is told after pressing Send, in one place because all three
// send surfaces (the campaign email editor, the Subscriber Report blast, the
// event-attendee dialog) hand back the same result and had drifted into three
// different sentences about it.
//
// It exists mainly for ONE case. Since the throttle rewrite (2026-09-04) the
// send engine holds campaign mail inside the relay's confirmed 2,000/hour
// ceiling, measured over a rolling hour across every email the system sends -
// so a perfectly healthy send can come back with sentImmediately: 0 when the
// hour is already spent. The old wording rendered that as
//
//     "Queued 2400 of 2400 - 0 sent immediately."
//
// which reads as a failure, and invites an admin to press Send again (harmless
// - the ledger is at-most-once - but alarming). Nothing is wrong in that case:
// every recipient is reserved and the scheduler drains them. The copy has to
// say so.
//
// Deliberately vague about the interval ("shortly", "over the next hour")
// rather than naming ten minutes: the pacing constants are tuned server-side,
// and copy that quotes them is copy that goes stale the next time they move.

/**
 * The snackbar line for a completed enqueue.
 *
 * @param result What enqueueCampaignEmail returned.
 * @param noun What is being sent, for the all-deferred sentence.
 * @returns A sentence describing what actually happened.
 */
export function sendResultMessage(
  result: EnqueueCampaignEmailResult,
  noun = 'email'
): string {
  const { recipients, sentImmediately } = result;

  if (recipients === 0) {
    return 'No recipients matched - nothing was sent.';
  }

  // Everything went out in the immediate drain: the small-send case, and the
  // only one where "sent" is the whole truth.
  if (sentImmediately >= recipients) {
    return `Sent to ${recipients} recipient(s).`;
  }

  // Nothing drained yet. Say why, and say that it is handled - this is the
  // throttled case the whole helper exists for.
  if (sentImmediately === 0) {
    return `${recipients} recipient(s) queued - this ${noun} starts going out ` +
      'shortly, kept under the hourly sending limit.';
  }

  const remaining = recipients - sentImmediately;
  return `Sent to ${sentImmediately} of ${recipients} - the remaining ` +
    `${remaining} go out over the next hour or so, kept under the hourly ` +
    'sending limit.';
}
