import { Timestamp } from 'firebase/firestore';
import { CheckoutForm } from '@impact-common/shared/models/utils/cart.model';
import { OrderTimelineComponent } from './order-timeline.component';

// Moved here from purchase-details.component.spec.ts on 2026-08-21 with the
// code they cover, when the order timeline was extracted out of that
// component (bucket A item #5, the last of the four god components). Written
// BEFORE the extraction, against the same logic in its old home, and passing
// here unchanged.
//
// House style: hand-constructed, duck-typed deps, no TestBed. The only
// dependency is PurchasesService, and only for the legacy-refund fallback's
// amount.

function makeComponent(item: Partial<CheckoutForm>, chargedAmount = 0) {
  const service = { getChargedDisplayAmount: () => chargedAmount };
  const component = new OrderTimelineComponent(service as never);
  component.item = { id: 'p-1', email: 'buyer@test.local', ...item } as CheckoutForm;
  return component;
}

const ts = (y: number, m: number, day: number) => Timestamp.fromDate(new Date(y, m, day));

describe('OrderTimelineComponent', () => {
  describe('timeline', () => {
    it('marks recorded history done, with the LAST one current', () => {
      const component = makeComponent({
        fulfillmentStatus: 'received',
        statusHistory: [
          { status: 'new', date: ts(2026, 0, 1) },
          { status: 'received', date: ts(2026, 0, 2), by: 'Sam' },
        ],
      } as Partial<CheckoutForm>);

      const nodes = component.timeline;
      expect(nodes[0].state).toBe('done');
      expect(nodes[1].state).toBe('current');
      expect(nodes[1].by).toBe('Sam');
    });

    it('renders steps still ahead as pending with NO date', () => {
      // Never fabricate a date for something that has not happened.
      const component = makeComponent({
        fulfillmentStatus: 'received',
        statusHistory: [
          { status: 'new', date: ts(2026, 0, 1) },
          { status: 'received', date: ts(2026, 0, 2) },
        ],
      } as Partial<CheckoutForm>);

      const pending = component.timeline.filter((n) => n.state === 'pending');
      expect(pending.length).toBeGreaterThan(0);
      expect(pending.every((n) => n.date === undefined)).toBeTrue();
    });

    it('falls back to ONE node for orders that predate statusHistory', () => {
      // Rather than inventing a history that was never captured.
      const component = makeComponent({
        fulfillmentStatus: 'closed',
        dateProcessed: ts(2026, 0, 5),
      } as Partial<CheckoutForm>);

      const done = component.timeline.filter((n) => n.state !== 'pending');
      expect(done.length).toBe(1);
      expect(done[0].state).toBe('current');
    });

    it('follows the AMAZON path once history passed through it', () => {
      const component = makeComponent({
        fulfillmentStatus: 'closed',
        statusHistory: [
          { status: 'new', date: ts(2026, 0, 1) },
          { status: 'shipped_via_amazon', date: ts(2026, 0, 2) },
          { status: 'closed', date: ts(2026, 0, 3) },
        ],
      } as Partial<CheckoutForm>);

      // Both paths share 'closed', but the Amazon one labels it differently.
      const last = component.timeline[component.timeline.length - 1];
      expect(last.step.label).toBe('Confirmation Email Sent');
    });

    it('labels a standard order\'s closed step "Product Shipped"', () => {
      const component = makeComponent({
        fulfillmentStatus: 'closed',
        statusHistory: [{ status: 'closed', date: ts(2026, 0, 3) }],
      } as Partial<CheckoutForm>);
      expect(component.timeline[0].step.label).toBe('Product Shipped');
    });

    it('survives an unrecognised status rather than throwing', () => {
      const component = makeComponent({
        fulfillmentStatus: 'new',
        statusHistory: [{ status: 'legacy_thing' as never, date: ts(2026, 0, 1) }],
      } as Partial<CheckoutForm>);
      expect(component.timeline[0].step.label).toBe('legacy_thing');
    });
  });

  describe('refundHistory', () => {
    it('passes recorded refunds through unchanged', () => {
      const refunds = [{ amount: 10, date: ts(2026, 0, 2) }];
      const component = makeComponent({ refunds } as Partial<CheckoutForm>);
      expect(component.refundHistory()).toBe(refunds as never);
    });

    it('synthesizes ONE row for a legacy fully-refunded order', () => {
      // Pre-refunds[] orders would otherwise show a blank history.
      const component = makeComponent({
        refunded: true,
        refundAmount: 50,
        refundedAt: ts(2026, 0, 2),
        refundedBy: 'Sam',
        refundId: 'RF-1',
      } as Partial<CheckoutForm>);

      const history = component.refundHistory();
      expect(history.length).toBe(1);
      expect(history[0].amount).toBe(50);
      expect(history[0].by).toBe('Sam');
      expect(history[0].refundId).toBe('RF-1');
    });

    it('falls back to the charged amount when the legacy row has none', () => {
      const component = makeComponent({
        refunded: true,
        refundedAt: ts(2026, 0, 2),
      } as Partial<CheckoutForm>, 42);
      expect(component.refundHistory()[0].amount).toBe(42);
    });

    it('omits by/refundId entirely when the legacy order has none', () => {
      const component = makeComponent({
        refunded: true,
        refundAmount: 50,
        refundedAt: ts(2026, 0, 2),
      } as Partial<CheckoutForm>);
      const entry = component.refundHistory()[0] as unknown as Record<string, unknown>;
      expect('by' in entry).toBeFalse();
      expect('refundId' in entry).toBeFalse();
    });

    it('is empty for an order that was never refunded', () => {
      expect(makeComponent({}).refundHistory()).toEqual([]);
    });
  });
});
