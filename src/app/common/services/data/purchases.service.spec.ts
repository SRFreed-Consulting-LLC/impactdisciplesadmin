import { CheckoutForm, FulfillmentStatus } from '@impact-common/shared/models/utils/cart.model';
import { AMAZON_CONFIRMATION_TEMPLATE_ID, PurchasesService } from './purchases.service';

// Hand-constructed with duck-typed deps, matching the house convention (see
// permission.service.spec.ts). This spec used to be the ONE exception,
// forced onto a minimal TestBed because PurchasesService took its Functions
// dependency through a `functions = inject(Functions)` FIELD initializer,
// which needs an injection context. That moved into the constructor on
// 2026-08-21 (bucket A item #7), so the exception is gone and this reads
// like every other service spec in the app.
describe('PurchasesService', () => {
  let service: PurchasesService;
  let updates: { id: string; value: CheckoutForm }[];
  let loggedInUser: { firstName?: string; lastName?: string; email?: string } | null;
  let templates: { html?: string; subject?: string }[];
  let templatesById: Record<string, { html?: string; subject?: string } | null>;
  let sentEmails: { to: string; subject: string; html: string }[];
  let snackbarErrors: string[];

  beforeEach(() => {
    updates = [];
    snackbarErrors = [];
    loggedInUser = { firstName: 'Ada', lastName: 'Admin', email: 'ada@test.local' };
    templates = [];
    templatesById = {};
    sentEmails = [];

    const dao = {
      update: (id: string, value: CheckoutForm) => {
        updates.push({ id, value });
        return Promise.resolve(value);
      },
    };
    const authService = {
      getLoggedInUser: () => loggedInUser,
      // getShippingLabel sends a real Firebase ID token - the Cloud
      // Function's staff gate is the only thing standing between a caller
      // and the org's postage balance.
      dao: { auth: { currentUser: { getIdToken: () => Promise.resolve('id-token') } } },
    };
    const snackbar = { error: (message: string) => snackbarErrors.push(message) };
    const emailService = {
      sendHtmlEmail: (to: string, subject: string, html: string) => {
        sentEmails.push({ to, subject, html });
        return Promise.resolve();
      },
    };
    // Two lookups, because the service prefers the PINNED DOCUMENT ID and
    // only falls back to the name. `templatesById` is what a pinned project
    // has; `templates` is what an un-pinned one still answers by name. Tests
    // set whichever they mean to exercise.
    const emailTemplatesService = {
      getById: (id: string) => Promise.resolve(templatesById[id] ?? null),
      getAllByValue: () => Promise.resolve(templates),
    };
    const functions = {};

    service = new PurchasesService(
      dao as never,
      authService as never,
      snackbar as never,
      emailService as never,
      emailTemplatesService as never,
      functions as never,
    );
  });

  const order = (overrides: Partial<CheckoutForm> = {}): CheckoutForm =>
    ({ id: 'order-1', email: 'buyer@test.local', firstName: 'Bea', lastName: 'Buyer', ...overrides }) as CheckoutForm;

  describe('status transitions + statusHistory', () => {
    it('acknowledgeOrder moves new -> received and appends a history entry', async () => {
      await service.acknowledgeOrder(order({ fulfillmentStatus: 'new' }));
      const written = updates[0].value;
      expect(written.fulfillmentStatus).toBe('received');
      expect(written.statusHistory!.length).toBe(1);
      expect(written.statusHistory![0].status).toBe('received');
      expect(written.statusHistory![0].by).toBe('Ada Admin');
    });

    it('appends to existing history rather than replacing it', async () => {
      const existing = [{ status: 'received' as FulfillmentStatus, date: null }];
      await service.markPackaged(order({ statusHistory: existing as CheckoutForm['statusHistory'] }));
      const written = updates[0].value;
      expect(written.statusHistory!.length).toBe(2);
      expect(written.statusHistory![1].status).toBe('awaiting_shipping');
    });

    it('THE undefined-write regression: no `by` KEY at all when the display cookie has lapsed', async () => {
      // currentUserLabel() -> undefined must OMIT the key, never write
      // by: undefined (Firestore rejects the entire setDoc otherwise -
      // live-diagnosed 2026-08-14, see withStatusHistory's comment).
      loggedInUser = null;
      await service.markShipped(order());
      const entry = updates[0].value.statusHistory![0];
      expect('by' in entry).toBe(false);
    });

    it('falls back to the email when the cached user has no names', async () => {
      loggedInUser = { email: 'ada@test.local' };
      await service.markPickedUp(order());
      expect(updates[0].value.statusHistory![0].by).toBe('ada@test.local');
      expect(updates[0].value.fulfillmentStatus).toBe('closed');
    });

    it('revertStatus records the back-step in history like a forward move', async () => {
      await service.revertStatus(order({ fulfillmentStatus: 'closed' }), 'received');
      const written = updates[0].value;
      expect(written.fulfillmentStatus).toBe('received');
      expect(written.statusHistory![0].status).toBe('received');
    });

    it('markShippedViaAmazon takes the Amazon branch', async () => {
      await service.markShippedViaAmazon(order({ fulfillmentStatus: 'received' }));
      expect(updates[0].value.fulfillmentStatus).toBe('shipped_via_amazon');
    });
  });

  describe('sendAmazonConfirmation', () => {
    it('throws before any state change when the purchase has no email', async () => {
      await expectAsync(service.sendAmazonConfirmation(order({ email: '' })))
        .toBeRejectedWithError(/no contact email/);
      expect(updates.length).toBe(0);
      expect(sentEmails.length).toBe(0);
    });

    it('throws (naming the template) when "Amazon Shipping Confirmation" is missing', async () => {
      templates = [];
      await expectAsync(service.sendAmazonConfirmation(order()))
        .toBeRejectedWithError(/Amazon Shipping Confirmation/);
      expect(updates.length).toBe(0);
    });

    it('renders merge tags, queues the email, then closes the order', async () => {
      templates = [{
        html: '<p>Hi *|FNAME|*!</p>',
        subject: 'Shipped, *|FNAME|*',
      }];
      await service.sendAmazonConfirmation(order());
      expect(sentEmails.length).toBe(1);
      expect(sentEmails[0].to).toBe('buyer@test.local');
      expect(sentEmails[0].subject).toBe('Shipped, Bea');
      expect(sentEmails[0].html).toContain('Hi Bea!');
      expect(updates[0].value.fulfillmentStatus).toBe('closed');
    });

    // The dialog shows the real email and lets it be reworded per order, so it
    // arrives with finished content. The stored template must not then be
    // consulted at all - re-rendering it would silently discard the edit.
    it('sends prepared content verbatim, without reading the template', async () => {
      templatesById = {};
      templates = []; // nothing to fall back to; only prepared content can work
      await service.sendAmazonConfirmation(order(), {
        subject: 'Reworded for this order',
        html: '<p>A note just for Bea.</p>'
      });
      expect(sentEmails[0].subject).toBe('Reworded for this order');
      expect(sentEmails[0].html).toBe('<p>A note just for Bea.</p>');
      expect(updates[0].value.fulfillmentStatus).toBe('closed');
    });

    // Every caller that has not been given an editor still works, and a
    // failure to build a preview can never leave an order unsendable.
    it('falls back to the stored template when content is only half prepared', async () => {
      templates = [{ html: 'FROM TEMPLATE', subject: 'Template subject' }];
      await service.sendAmazonConfirmation(order(), { subject: 'Only a subject', html: '' });
      expect(sentEmails[0].html).toBe('FROM TEMPLATE');
      expect(sentEmails[0].subject).toBe('Template subject');
    });

    // amazonTracking was written from a prompt whose value reached no customer:
    // the template holds *|FNAME|* and no *|TRACKING|* tag at all. The prompt
    // is gone, and with it the write - historical values are left alone.
    it('no longer writes amazonTracking', async () => {
      templates = [{ html: 'x' }];
      await service.sendAmazonConfirmation(order());
      expect('amazonTracking' in updates[0].value).toBeFalse();
    });

    it('closeWithoutConfirmation closes the order and sends nothing at all', async () => {
      templates = [{ html: 'x' }];
      await service.closeWithoutConfirmation(order());
      expect(sentEmails.length).toBe(0);
      expect(updates[0].value.fulfillmentStatus).toBe('closed');
    });

    it('closing without a confirmation still records who did it, and when', async () => {
      await service.closeWithoutConfirmation(order());
      const history = updates[0].value.statusHistory;
      expect(history[history.length - 1].status).toBe('closed');
      expect(history[history.length - 1].date).toBeTruthy();
    });

    // The template is addressed by PINNED DOCUMENT ID (2026-08-27). A name is
    // an editable text field, and renaming this template used to stop the
    // shipping confirmation with no error anywhere.
    it('prefers the template at the pinned id over any same-named document', async () => {
      templatesById[AMAZON_CONFIRMATION_TEMPLATE_ID] = { html: 'PINNED' };
      templates = [{ html: 'FOUND BY NAME' }];
      await service.sendAmazonConfirmation(order());
      expect(sentEmails[0].html).toBe('PINNED');
    });

    it('falls back to the name when the pinned id is absent', async () => {
      // A project whose data has not been pinned yet must keep sending -
      // otherwise the order of a deploy could stop confirmations.
      templatesById = {};
      templates = [{ html: 'FOUND BY NAME' }];
      await service.sendAmazonConfirmation(order());
      expect(sentEmails[0].html).toBe('FOUND BY NAME');
    });

    it('a renamed template is still found, because the id is what is used', async () => {
      templatesById[AMAZON_CONFIRMATION_TEMPLATE_ID] = { html: 'STILL SENT' };
      templates = []; // nothing answers to the old name any more
      await service.sendAmazonConfirmation(order());
      expect(sentEmails[0].html).toBe('STILL SENT');
      expect(updates[0].value.fulfillmentStatus).toBe('closed');
    });
  });

  describe('refund state + amounts', () => {
    it('getRefundStateLabel distinguishes full, partial, and none', () => {
      expect(service.getRefundStateLabel(order({ refunded: true }))).toBe('REFUNDED');
      expect(service.getRefundStateLabel(order({ refundAmount: 5 }))).toBe('PARTIALLY REFUNDED');
      expect(service.getRefundStateLabel(order())).toBeNull();
      expect(service.getRefundStateLabel(order({ refundAmount: 0 }))).toBeNull();
    });

    it('getRemainingRefundable = charged minus refunds, floored at 0, no float dust', () => {
      expect(service.getRemainingRefundable(order({ total: 10.1, refundAmount: 3.33 }))).toBe(6.77);
      expect(service.getRemainingRefundable(order({ total: 5, refundAmount: 9 }))).toBe(0);
      expect(service.getRemainingRefundable(order({ total: 20 }))).toBe(20);
    });

    it('getChargedDisplayAmount subtracts the discount for non-PayPal orders (2026-08-12 fix)', () => {
      expect(service.getChargedDisplayAmount(order({ total: 50, discount: 10 }))).toBe(40);
      expect(service.getChargedDisplayAmount(order({ total: 5, discount: 9 }))).toBe(0);
    });

    it('getChargedDisplayAmount prefers the PayPal receipt when present', () => {
      const withReceipt = order({
        total: 999,
        payPalReceipt: { purchase_units: [{ amount: { value: '42.50' } }] } as CheckoutForm['payPalReceipt'],
      });
      expect(service.getChargedDisplayAmount(withReceipt)).toBe(42.5);
    });
  });

  describe('status labels', () => {
    it('resolves labels across BOTH fulfillment paths', () => {
      expect(service.getFulfillmentStatusLabel('awaiting_shipping')).toBe('Awaiting Shipping');
      expect(service.getFulfillmentStatusLabel('shipped_via_amazon')).toBe('Shipped via Amazon');
      expect(service.getFulfillmentStatusLabel(undefined)).toBe('Unknown');
    });
  });

  // A failed label attempt is a failure, not a label. Until 2026-09-02 it was
  // assigned to item.shippingLabel exactly like a success, and both halves of
  // that hurt: the next click re-printed the stale message instead of
  // retrying, and because update() is a whole-document setDoc of `item`, the
  // next workflow action persisted the error blob onto the purchase - after
  // which the order could never be labelled from ANY screen. Four purchases
  // on dev reached that state before anyone noticed.
  //
  // All four entry points (dashboard workflow dialog, Fulfillment, order
  // details, Purchases list) delegate here, so these are the only tests that
  // need to exist for the behaviour.
  describe('getShippingLabel', () => {
    let fetchCalls: number;

    const respondWith = (status: number, body: unknown) => {
      fetchCalls = 0;
      spyOn(window, 'fetch').and.callFake(() => {
        fetchCalls++;
        return Promise.resolve({ ok: status < 400, json: () => Promise.resolve(body) } as Response);
      });
    };

    beforeEach(() => {
      fetchCalls = 0;
      // A successful buy ends in an anchor click to download the PDF. Left
      // alone that is a real navigation attempt from inside the test runner.
      spyOn(HTMLAnchorElement.prototype, 'click');
    });

    it('a failure is NOT written onto the order, and the reason is shown', async () => {
      respondWith(400, { code: 400, error: { message: 'This order has no shipping service on it.' } });
      const item = order({ fulfillmentStatus: 'received' });

      await service.getShippingLabel(item);

      expect(snackbarErrors).toEqual(['This order has no shipping service on it.']);
      // The whole regression in one assertion.
      expect(item.shippingLabel).toBeUndefined();
      // Nothing was saved, so the failure cannot be persisted by a later
      // whole-document write, and the status did not advance.
      expect(updates.length).toBe(0);
      expect(item.fulfillmentStatus).toBe('received');
    });

    it('a second click RETRIES rather than replaying the first failure', async () => {
      respondWith(502, { code: 502, error: { message: 'The carrier refused this label: PO Box.' } });
      const item = order({ fulfillmentStatus: 'received' });

      await service.getShippingLabel(item);
      await service.getShippingLabel(item);

      expect(fetchCalls).toBe(2);
      expect(snackbarErrors.length).toBe(2);
    });

    it('an error persisted by an OLDER client does not block the retry', async () => {
      // The four stranded orders on dev look exactly like this.
      respondWith(200, { labelDownload: { pdf: 'https://example.test/l.pdf' }, trackingNumber: 'T1' });
      const item = order({
        fulfillmentStatus: 'received',
        shippingLabel: { code: 502, error: { message: 'Unable to purchase a shipping label.' } },
      } as Partial<CheckoutForm>);

      await service.getShippingLabel(item);

      expect(fetchCalls).toBe(1);
      expect(item.shippingLabel['trackingNumber']).toBe('T1');
      expect(item.fulfillmentStatus).toBe('shipping_label_printed');
      expect(updates.length).toBe(1);
    });

    it('a success advances the workflow and records the cost drift', async () => {
      respondWith(200, {
        labelDownload: { pdf: 'https://example.test/l.pdf' },
        shippingCostDrift: { quoted: 4.25, actual: 9.42, drift: 5.17 },
      });
      const item = order({ fulfillmentStatus: 'received' });

      await service.getShippingLabel(item);

      expect(item.fulfillmentStatus).toBe('shipping_label_printed');
      const written = updates[0].value as CheckoutForm & { shippingCostDrift?: { drift: number } };
      // Carried onto the in-memory copy BEFORE the setDoc, or the write
      // would clobber the record the server just made.
      expect(written.shippingCostDrift!.drift).toBe(5.17);
      expect(snackbarErrors).toEqual([]);
    });
  });
});
