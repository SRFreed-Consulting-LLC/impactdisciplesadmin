import { Timestamp } from 'firebase/firestore';
import { CartItem, CheckoutForm } from '@impact-common/shared/models/utils/cart.model';
import { PurchaseDetailsComponent } from './purchase-details.component';

// CHARACTERIZATION tests, written 2026-08-21 immediately BEFORE splitting
// this component (refactor sweep, bucket A item #5 - fourth and last god
// component). 468 lines of TS + 297 of template across seven concerns:
// refunds, customer/addresses, the discount breakdown, the item list, the
// order timeline, the workflow actions and the back-step control.
//
// Weighted toward the derivations that would be expensive to get wrong and
// are invisible from the template: the timeline's done/current/pending
// states and its legacy fallback, the Amazon-vs-standard path split, the
// back-step list, and the refund gates (a $0/coupon order can only be
// marked fully refunded - there is no PayPal charge to take money back
// from). The thin workflow actions that just call a service and copy two
// fields back are covered once, as a pattern, rather than seven times.
//
// House style: hand-constructed class with duck-typed deps, no TestBed.

function makeDeps(overrides: Record<string, unknown> = {}) {
  const saved = (status: string) => Promise.resolve({
    fulfillmentStatus: status,
    statusHistory: [{ status, date: Timestamp.now() }],
  });
  return {
    service: {
      getRemainingRefundable: () => 0,
      getChargedDisplayAmount: () => 0,
      calculateItemTotalAmount: () => 0,
      update: jasmine.createSpy('update').and.returnValue(Promise.resolve({})),
      refundPurchase: jasmine.createSpy('refundPurchase'),
      acknowledgeOrder: jasmine.createSpy('acknowledgeOrder').and.returnValue(saved('received')),
      markPickedUp: jasmine.createSpy('markPickedUp').and.returnValue(saved('closed')),
      markPackaged: jasmine.createSpy('markPackaged').and.returnValue(saved('awaiting_shipping')),
      markShipped: jasmine.createSpy('markShipped').and.returnValue(saved('closed')),
      markShippedViaAmazon: jasmine.createSpy('markShippedViaAmazon').and.returnValue(saved('shipped_via_amazon')),
      revertStatus: jasmine.createSpy('revertStatus').and.returnValue(saved('received')),
      getShippingLabel: () => Promise.resolve(),
    },
    authService: { dao: { loggedInUser$: { subscribe: (fn: (u: unknown) => void) => fn({ role: 'Admin' }) } } },
    confirmService: { confirm: jasmine.createSpy('confirm').and.returnValue(Promise.resolve(true)) },
    snackbar: { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') },
    customerService: { getAllByValue: () => Promise.resolve([]) },
    eventService: { getAll: () => Promise.resolve([]) },
    dialog: { open: jasmine.createSpy('open') },
    ...overrides,
  };
}

function aPurchase(extra: Partial<CheckoutForm> = {}): CheckoutForm {
  return {
    id: 'p-1',
    email: 'buyer@test.local',
    firstName: 'Alex',
    lastName: 'Doe',
    total: 50,
    receipt: 'PAYPAL-123',
    cartItems: [],
    ...extra,
  } as CheckoutForm;
}

function makeComponent(purchase: CheckoutForm = aPurchase(), overrides: Record<string, unknown> = {}) {
  const d = makeDeps(overrides);
  const component = new PurchaseDetailsComponent(
    d.service as never,
    d.authService as never,
    d.confirmService as never,
    d.snackbar as never,
    d.customerService as never,
    d.eventService as never,
    d.dialog as never,
  );
  component.selectedItem = purchase;
  return { component, deps: d };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

const ts = (y: number, m: number, day: number) => Timestamp.fromDate(new Date(y, m, day));

describe('PurchaseDetailsComponent (characterization, pre-split)', () => {

  describe('backSteps', () => {
    it('lists THIS order\'s earlier steps, most recent first', () => {
      const { component } = makeComponent(aPurchase({
        fulfillmentStatus: 'awaiting_shipping',
      } as Partial<CheckoutForm>));
      expect(component.backSteps.map((s) => s.status))
        .toEqual(['shipping_label_printed', 'received', 'new']);
    });

    it('is empty at the first step', () => {
      const { component } = makeComponent(aPurchase({ fulfillmentStatus: 'new' } as Partial<CheckoutForm>));
      expect(component.backSteps).toEqual([]);
    });

    it('offers reopening a closed order', () => {
      const { component } = makeComponent(aPurchase({ fulfillmentStatus: 'closed' } as Partial<CheckoutForm>));
      expect(component.backSteps.length).toBeGreaterThan(0);
    });

    it('follows the Amazon path for an Amazon order', () => {
      const { component } = makeComponent(aPurchase({
        fulfillmentStatus: 'closed',
        statusHistory: [{ status: 'shipped_via_amazon', date: ts(2026, 0, 2) }],
      } as Partial<CheckoutForm>));
      expect(component.backSteps.map((s) => s.status))
        .toEqual(['shipped_via_amazon', 'received', 'new']);
    });

    it('revertTo records the move and reports it, after confirming', async () => {
      const { component, deps } = makeComponent(aPurchase({ fulfillmentStatus: 'awaiting_shipping' } as Partial<CheckoutForm>));
      await component.revertTo({ status: 'received', label: 'Order Acknowledged', statusLabel: 'Received' });
      await flush();
      expect(deps.confirmService.confirm).toHaveBeenCalled();
      expect(deps.service.revertStatus).toHaveBeenCalled();
      expect(component.selectedItem.fulfillmentStatus).toBe('received');
    });

    it('revertTo does nothing when the confirm is declined', async () => {
      const { component, deps } = makeComponent(aPurchase({ fulfillmentStatus: 'awaiting_shipping' } as Partial<CheckoutForm>));
      deps.confirmService.confirm.and.returnValue(Promise.resolve(false));
      await component.revertTo({ status: 'received', label: 'Order Acknowledged', statusLabel: 'Received' });
      expect(deps.service.revertStatus).not.toHaveBeenCalled();
    });
  });

  // A $0 / coupon / free order has no PayPal charge to take money back
  // from, so it can only ever be marked FULLY refunded.
  describe('refund gates', () => {
    it('allows a refund only for an Admin, on an unrefunded order with a remainder', () => {
      const { component } = makeComponent(aPurchase(), {
        service: { ...makeDeps().service, getRemainingRefundable: () => 25 },
      });
      expect(component.canRefund()).toBeTrue();
    });

    it('refuses once the order is already refunded', () => {
      const { component } = makeComponent(aPurchase({ refunded: true } as Partial<CheckoutForm>), {
        service: { ...makeDeps().service, getRemainingRefundable: () => 25 },
      });
      expect(component.canRefund()).toBeFalse();
    });

    it('refuses when nothing is left to refund', () => {
      const { component } = makeComponent(aPurchase(), {
        service: { ...makeDeps().service, getRemainingRefundable: () => 0 },
      });
      expect(component.canRefund()).toBeFalse();
    });

    it('refuses a non-Admin', () => {
      const { component } = makeComponent(aPurchase(), {
        authService: { dao: { loggedInUser$: { subscribe: (fn: (u: unknown) => void) => fn({ role: 'Editor' }) } } },
        service: { ...makeDeps().service, getRemainingRefundable: () => 25 },
      });
      expect(component.canRefund()).toBeFalse();
    });
  });


  // Attribution, not arithmetic: these are already server-verified totals.
  describe('discount breakdown', () => {
    it('reports a coupon and a shipping discount separately, and their sum', () => {
      const { component } = makeComponent(aPurchase({ discount: 5, shippingDiscount: 3 } as Partial<CheckoutForm>));
      expect(component.couponAmount).toBe(5);
      expect(component.shippingDiscountAmount).toBe(3);
      expect(component.totalDiscountAmount).toBe(8);
      expect(component.hasDiscounts).toBeTrue();
    });

    it('treats absent or non-positive values as no discount', () => {
      const { component } = makeComponent(aPurchase({ discount: 0, shippingDiscount: -1 } as Partial<CheckoutForm>));
      expect(component.couponAmount).toBe(0);
      expect(component.shippingDiscountAmount).toBe(0);
      expect(component.hasDiscounts).toBeFalse();
    });

    it('lists independently marked-down items, with no invented saving', () => {
      // The pre-sale list price was never persisted, only what was charged.
      const { component } = makeComponent(aPurchase({
        cartItems: [
          { itemName: 'On sale', salePrice: 8 },
          { itemName: 'Full price' },
        ] as CartItem[],
      } as Partial<CheckoutForm>));
      expect(component.onSaleItems.map((i) => i.itemName)).toEqual(['On sale']);
    });
  });

  describe('items', () => {
    it('counts ordered units, not lines', () => {
      const { component } = makeComponent(aPurchase({
        cartItems: [{ orderQuantity: 2 }, { orderQuantity: 3 }, {}] as CartItem[],
      } as Partial<CheckoutForm>));
      expect(component.getOrderItemCount()).toBe(5);
    });

    it('treats only non-event, non-digital items as physical', () => {
      const { component } = makeComponent();
      expect(component.isPhysical({ } as CartItem)).toBeTrue();
      expect(component.isPhysical({ isEvent: true } as CartItem)).toBeFalse();
      expect(component.isPhysical({ isEBook: true } as CartItem)).toBeFalse();
      expect(component.isPhysical({ isDigitalBook: true } as CartItem)).toBeFalse();
    });

    it('offers "mark shipped" only for a non-event item not already shipped or refunded', () => {
      const { component } = makeComponent();
      expect(component.isShippedButtonVisible({ isEvent: false } as CartItem)).toBeTrue();
      expect(component.isShippedButtonVisible({ isEvent: true } as CartItem)).toBeFalse();
      expect(component.isShippedButtonVisible({ isEvent: false, processedStatus: 'SHIPPED' } as CartItem)).toBeFalse();
      expect(component.isShippedButtonVisible({ isEvent: false, processedStatus: 'REFUNDED' } as CartItem)).toBeFalse();
    });

    it('closes the ORDER once every item is shipped', async () => {
      const items = [
        { itemName: 'A', orderQuantity: 1, isEvent: false, processedStatus: 'SHIPPED' },
        { itemName: 'B', orderQuantity: 1, isEvent: false },
      ] as CartItem[];
      const { component, deps } = makeComponent(aPurchase({ cartItems: items } as Partial<CheckoutForm>));

      component.markAsShipped(items[1]);
      await flush();

      expect(items[1].processedStatus).toBe('SHIPPED');
      expect(component.selectedItem.fulfillmentStatus).toBe('closed');
      expect(deps.service.update).toHaveBeenCalled();
    });

    it('leaves the order open while any item is unshipped', async () => {
      const items = [
        { itemName: 'A', orderQuantity: 1, isEvent: false },
        { itemName: 'B', orderQuantity: 1, isEvent: false },
      ] as CartItem[];
      const { component } = makeComponent(aPurchase({
        cartItems: items, fulfillmentStatus: 'received',
      } as Partial<CheckoutForm>));

      component.markAsShipped(items[0]);
      await flush();

      expect(component.selectedItem.fulfillmentStatus).toBe('received');
    });

    it('does nothing when the confirm is declined', async () => {
      const items = [{ itemName: 'A', isEvent: false }] as CartItem[];
      const { component, deps } = makeComponent(aPurchase({ cartItems: items } as Partial<CheckoutForm>));
      deps.confirmService.confirm.and.returnValue(Promise.resolve(false));

      component.markAsShipped(items[0]);
      await flush();

      expect(items[0].processedStatus).toBeUndefined();
      expect(deps.service.update).not.toHaveBeenCalled();
    });
  });

  describe('customer display', () => {
    it('prefers the name, falls back to email, then Unknown', () => {
      expect(makeComponent().component.customerName()).toBe('Alex Doe');
      expect(makeComponent(aPurchase({ firstName: '', lastName: '' } as Partial<CheckoutForm>))
        .component.customerName()).toBe('buyer@test.local');
      expect(makeComponent(aPurchase({ firstName: '', lastName: '', email: '' } as Partial<CheckoutForm>))
        .component.customerName()).toBe('Unknown');
    });

    it('shows an em dash rather than a blank phone', () => {
      expect(makeComponent().component.phoneDisplay()).toBe('—');
      const withPhone = makeComponent(aPurchase({
        phone: { countryCode: '+1', number: '555-1212' },
      } as Partial<CheckoutForm>));
      expect(withPhone.component.phoneDisplay()).toBe('+1 555-1212');
    });

    it('warns rather than opening a dialog when no contact record exists', async () => {
      const { component, deps } = makeComponent();
      await component.viewCustomer();
      expect(deps.snackbar.error).toHaveBeenCalled();
      expect(deps.dialog.open).not.toHaveBeenCalled();
    });

    it('does not attempt a lookup without an email', async () => {
      const { component, deps } = makeComponent(aPurchase({ email: '' } as Partial<CheckoutForm>));
      await component.viewCustomer();
      expect(deps.snackbar.error).not.toHaveBeenCalled();
      expect(deps.dialog.open).not.toHaveBeenCalled();
    });
  });

  // Seven near-identical actions; covered once as a pattern - each calls its
  // service method and copies status + history back onto the local item so
  // the screen updates without a refetch.
  describe('workflow actions', () => {
    it('acknowledgeOrder copies the saved status and history back', async () => {
      const { component, deps } = makeComponent();
      component.acknowledgeOrder();
      await flush();
      expect(deps.service.acknowledgeOrder).toHaveBeenCalled();
      expect(component.selectedItem.fulfillmentStatus).toBe('received');
      expect(component.selectedItem.statusHistory?.length).toBe(1);
      expect(deps.snackbar.success).toHaveBeenCalled();
    });

    it('markShipped closes the order', async () => {
      const { component } = makeComponent();
      component.markShipped();
      await flush();
      expect(component.selectedItem.fulfillmentStatus).toBe('closed');
    });

    it('markShippedViaAmazon moves it onto the Amazon path', async () => {
      const { component } = makeComponent();
      component.markShippedViaAmazon();
      await flush();
      expect(component.selectedItem.fulfillmentStatus).toBe('shipped_via_amazon');
      // And the order is now genuinely ON that branch, not just labelled -
      // backSteps is path-aware, so it walks the Amazon path from here.
      // (The timeline's own view of this moved to
      // order-timeline.component.spec.ts with the code.)
      expect(component.backSteps.map((s) => s.status)).toEqual(['received', 'new']);
    });

    it('printShippingLabel clears its busy flag even if the call fails', async () => {
      const { component } = makeComponent(aPurchase(), {
        service: { ...makeDeps().service, getShippingLabel: () => Promise.reject(new Error('boom')) },
      });
      await component.printShippingLabel().catch(() => undefined);
      expect(component.printing).toBeFalse();
    });
  });

  describe('role visibility', () => {
    it('reads the role off the logged-in user stream', () => {
      const { component } = makeComponent();
      expect(component.isVisible(['Admin'])).toBeTrue();
      expect(component.isVisible(['Root'])).toBeFalse();
    });
  });
});
