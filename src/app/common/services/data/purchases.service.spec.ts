import { TestBed } from '@angular/core/testing';
import { Functions } from '@angular/fire/functions';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { SnackbarService } from 'src/app/shared/snackbar.service';
import { CheckoutForm, FulfillmentStatus } from 'src/app/common/models/utils/cart.model';
import { PurchasesService } from './purchases.service';
import { EMailService } from './email.service';
import { EMailTemplatesService } from './email-templates.service';

// House convention is hand-construction with duck-typed deps (see
// permission.service.spec.ts) - PurchasesService is the one service that
// can't be built that way, because its `functions = inject(Functions)`
// FIELD initializer requires an injection context. So this spec uses the
// minimal TestBed instead: every provider is an inert stub, nothing touches
// Firebase or the network.
describe('PurchasesService', () => {
  let service: PurchasesService;
  let updates: { id: string; value: CheckoutForm }[];
  let loggedInUser: { firstName?: string; lastName?: string; email?: string } | null;
  let templates: { html?: string; subject?: string }[];
  let sentEmails: { to: string; subject: string; html: string }[];

  beforeEach(() => {
    updates = [];
    loggedInUser = { firstName: 'Ada', lastName: 'Admin', email: 'ada@test.local' };
    templates = [];
    sentEmails = [];

    TestBed.configureTestingModule({
      providers: [
        PurchasesService,
        {
          provide: FirebaseDAO,
          useValue: {
            update: (id: string, value: CheckoutForm) => {
              updates.push({ id, value });
              return Promise.resolve(value);
            },
          },
        },
        { provide: AdminAuthService, useValue: { getLoggedInUser: () => loggedInUser } },
        { provide: SnackbarService, useValue: {} },
        {
          provide: EMailService,
          useValue: {
            sendHtmlEmail: (to: string, subject: string, html: string) => {
              sentEmails.push({ to, subject, html });
              return Promise.resolve();
            },
          },
        },
        { provide: EMailTemplatesService, useValue: { getAllByValue: () => Promise.resolve(templates) } },
        { provide: Functions, useValue: {} },
      ],
    });
    service = TestBed.inject(PurchasesService);
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
