import { sendResultMessage } from './send-result-message';

// The case worth pinning is the THROTTLED one: since the send engine holds
// campaign mail inside the relay's confirmed 2,000/hour ceiling, a healthy
// send can legitimately return sentImmediately: 0, and the copy must not read
// as a failure. See the helper's own header.
describe('sendResultMessage', () => {
  it('reports a fully-drained small send as simply sent', () => {
    const msg = sendResultMessage({ recipients: 6, queued: 6, sentImmediately: 6 });
    expect(msg).toBe('Sent to 6 recipient(s).');
  });

  it('never claims "0 sent" when the hour is spent - it says the send is paced', () => {
    const msg = sendResultMessage({ recipients: 2400, queued: 2400, sentImmediately: 0 });
    expect(msg).not.toContain('0 sent');
    expect(msg).toContain('2400 recipient(s) queued');
    expect(msg).toContain('hourly sending limit');
  });

  it('names the thing being sent in the all-deferred message', () => {
    const msg = sendResultMessage(
      { recipients: 500, queued: 500, sentImmediately: 0 }, 'newsletter');
    expect(msg).toContain('this newsletter starts going out');
  });

  it('reports a partial drain with both halves and the remainder', () => {
    const msg = sendResultMessage({ recipients: 100, queued: 100, sentImmediately: 25 });
    expect(msg).toContain('Sent to 25 of 100');
    expect(msg).toContain('remaining 75');
  });

  it('an empty audience says nothing was sent rather than "sent to 0"', () => {
    const msg = sendResultMessage({ recipients: 0, queued: 0, sentImmediately: 0 });
    expect(msg).toBe('No recipients matched - nothing was sent.');
  });

  it('treats an over-count of sends as fully sent rather than a negative remainder', () => {
    // Defensive: sentImmediately can exceed this touch's own recipients,
    // because a drain takes the oldest queued reservations across every
    // touch - so a Send now can carry another campaign's backlog out with it.
    const msg = sendResultMessage({ recipients: 6, queued: 6, sentImmediately: 12 });
    expect(msg).toBe('Sent to 6 recipient(s).');
  });
});
