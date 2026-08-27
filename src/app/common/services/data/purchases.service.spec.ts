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

  beforeEach(() => {
    updates = [];
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
    const authService = { getLoggedInUser: () => loggedInUser };
    const snackbar = {};
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
        html: '<p>Hi *|FNAME|*! *|TRACKING|No tracking available|*</p>',
        subject: 'Shipped, *|FNAME|*',
      }];
      await service.sendAmazonConfirmation(order(), ' TRK-99 ');
      expect(sentEmails.length).toBe(1);
      expect(sentEmails[0].to).toBe('buyer@test.local');
      expect(sentEmails[0].subject).toBe('Shipped, Bea');
      expect(sentEmails[0].html).toContain('Hi Bea!');
      expect(sentEmails[0].html).toContain('Tracking: TRK-99');
      const written = updates[0].value;
      expect(written.fulfillmentStatus).toBe('closed');
      expect(written.amazonTracking).toBe('TRK-99');
    });

    it('no tracking -> the inline fallback renders and amazonTracking stores null', async () => {
      templates = [{ html: '*|TRACKING|No tracking available|*' }];
      await service.sendAmazonConfirmation(order());
      expect(sentEmails[0].html).toBe('No tracking available');
      expect(sentEmails[0].subject).toBe('Your order is on its way!');
      expect(updates[0].value.amazonTracking).toBeNull();
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
});
