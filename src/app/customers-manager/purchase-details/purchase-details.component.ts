import { Component, Input } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { Timestamp } from 'firebase/firestore';
import { CartItem, CheckoutForm, FulfillmentStatus } from 'src/app/common/models/utils/cart.model';
import { PurchasesService } from 'src/app/common/services/data/purchases.service';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { hasRole } from 'src/app/common/lists/roles.enum';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { FULFILLMENT_STEPS, FulfillmentStep } from '../fulfillment/fulfillment-steps';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';

export interface TimelineNode {
  step: FulfillmentStep;
  state: 'done' | 'current' | 'pending';
  date?: Date | Timestamp;
  by?: string;
}

// Embedded inside PurchasesComponent's edit view - as of 2026-08-13 this IS
// the entire edit screen (there is no longer a separate Contact tab/dialog;
// purchases.component.html renders nothing but this). Redesigned from a
// single dense item table + a separate editable-address tab into one page:
// customer & address panel (shipping address/phone still editable here,
// same form/fields the old Contact tab had - billing address stays
// read-only, it was never editable), order-total stat tiles, a real
// discount-source breakdown, an order timeline, and the item list, per the
// reviewed mockup - https://claude.ai/code/artifact/adb6fa1b-28fa-4f50-9901-113f2730e0c8
// (merge of that gallery's "Stat Tiles" + "Timeline" concepts -
// https://claude.ai/code/artifact/bc048b67-a51f-49d0-85d2-47ab5fea23e6).
// The per-line-item refund action (refundLineItem) is fully commented out in
// both the template and the TS of the original - not ported at all, nothing
// lost since it was unreachable there either.
@Component({
    selector: 'app-purchase-details',
    templateUrl: './purchase-details.component.html',
    styleUrls: ['./purchase-details.component.scss'],
    standalone: false
})
export class PurchaseDetailsComponent {
  @Input() selectedItem: CheckoutForm;

  // Owned by PurchasesComponent (built in showEditModal(), submitted by its
  // own Save button) - passed down rather than rebuilt here so there's still
  // exactly one save flow, same as before this screen absorbed the Contact
  // tab. Only ever has phone/shippingAddress controls.
  @Input() form: FormGroup;

  // Was read fresh via authService.getLoggedInUser().role on every
  // isVisible() call - see events.component.ts for the full explanation
  // (a stale/expired role cookie throwing on a valid Firebase session).
  currentUserRole?: string;

  printing = false;

  constructor(
    public service: PurchasesService,
    private authService: AdminAuthService,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {
    this.authService.dao.loggedInUser$.subscribe((user) => {
      this.currentUserRole = user?.role;
    });
  }

  isVisible(roles: string[]): boolean {
    return hasRole(this.currentUserRole, roles);
  }

  // ---- Addresses ----

  customerName(): string {
    return [this.selectedItem.firstName, this.selectedItem.lastName].filter(Boolean).join(' ') || this.selectedItem.email || 'Unknown';
  }

  getOrderItemCount(): number {
    return (this.selectedItem.cartItems ?? []).map((cartItem) => cartItem.orderQuantity ?? 0).reduce((a, b) => a + b, 0);
  }

  // ---- Discount breakdown ----
  // discount/shippingDiscount are real, already-server-verified totals (see
  // functions/src/utils/checkout-pricing.functions.ts#computeOrderPricing) -
  // this just attributes each to its actual source instead of showing one
  // opaque "Discount" number:
  //  - `discount` only ever comes from a coupon, and only ever discounts
  //    items that are NOT already on sale (a sale always wins over a coupon
  //    on the same line - see that function's own comment on `isOnSale`), so
  //    it's safe to label unconditionally as the coupon's product-side effect.
  //  - `shippingDiscount` comes from either the free-shipping threshold or an
  //    active sitewide shipping sale, never from a coupon - shippingDiscountReason
  //    already carries which one, stamped server-side at checkout.
  //  - a cart item's own `salePrice` means it was independently marked down
  //    at checkout, unrelated to any coupon - flagged below, but with no
  //    dollar figure: the pre-sale list price was never persisted onto the
  //    order, only the price actually charged, so a "saved $X" number here
  //    would have to be invented.

  get couponAmount(): number {
    return (this.selectedItem.discount ?? 0) > 0 ? this.selectedItem.discount! : 0;
  }

  get shippingDiscountAmount(): number {
    return (this.selectedItem.shippingDiscount ?? 0) > 0 ? this.selectedItem.shippingDiscount! : 0;
  }

  get hasDiscounts(): boolean {
    return this.couponAmount > 0 || this.shippingDiscountAmount > 0;
  }

  get totalDiscountAmount(): number {
    return this.couponAmount + this.shippingDiscountAmount;
  }

  get onSaleItems(): CartItem[] {
    return (this.selectedItem.cartItems ?? []).filter((item) => (item.salePrice ?? 0) > 0);
  }

  // ---- Items ----

  isPhysical(item: CartItem): boolean {
    return !item.isEvent && !item.isEBook && !item.isDigitalBook;
  }

  // costRow() wraps a CartItem back into the {data: item} shape
  // PurchasesService's calculate* helpers expect - those helpers were
  // written for DevExtreme's row objects, not the raw model. Wrapping at the
  // call site (rather than changing the shared service) keeps this a
  // presentational-only change.
  costRow(item: CartItem) {
    return { data: item };
  }

  itemTotal(item: CartItem): number {
    return this.service.calculateItemTotalAmount(this.costRow(item), this.selectedItem);
  }

  isShippedButtonVisible(item: CartItem): boolean {
    return item.isEvent === false && item.processedStatus !== 'SHIPPED' && item.processedStatus !== 'REFUNDED';
  }

  markAsShipped(item: CartItem): void {
    this.confirmService.confirm('<i>Are you sure you want to mark item as Shipped?</i>', 'Confirm').then((confirmed) => {
      if (!confirmed) {
        return;
      }

      item.processedStatus = 'SHIPPED';
      item.dateProcessed = dateFromTimestamp(Timestamp.now() as Timestamp) as unknown as Timestamp;

      const isOrderComplete = (this.selectedItem.cartItems ?? []).every((cartItem) => cartItem.processedStatus === 'SHIPPED');
      if (isOrderComplete) {
        this.selectedItem.fulfillmentStatus = 'closed';
        this.selectedItem.dateProcessed = Timestamp.now();
      }

      this.service.update(this.selectedItem.id!, this.selectedItem).then(() => {
        this.snackbar.success(`${item.itemName} x (${item.orderQuantity}) marked as ${item.processedStatus}`);
      });
    });
  }

  // ---- Timeline ----
  // Real recorded events (selectedItem.statusHistory) render as "done"/
  // "current" with their actual date + who did it; steps still ahead of the
  // current status render as "pending" with no date, never a fabricated one.
  // Orders that predate statusHistory (see StatusHistoryEntry's own comment,
  // cart.model.ts) have none recorded - falls back to a single node built
  // from dateProcessed + the current status, rather than inventing a history
  // that was never captured.
  get timeline(): TimelineNode[] {
    const recorded = this.selectedItem.statusHistory?.length
      ? this.selectedItem.statusHistory
      : [{ status: (this.selectedItem.fulfillmentStatus ?? 'new') as FulfillmentStatus, date: this.selectedItem.dateProcessed as Timestamp }];

    const doneNodes: TimelineNode[] = recorded.map((entry) => ({
      step: this.stepFor(entry.status),
      state: 'done',
      date: entry.date,
      by: entry.by
    }));

    // The most recently recorded transition is the order's current state,
    // not a finished one - correct that single node after the fact rather
    // than special-casing the map above.
    if (doneNodes.length) {
      doneNodes[doneNodes.length - 1].state = 'current';
    }

    const currentIndex = FULFILLMENT_STEPS.findIndex((s) => s.status === this.selectedItem.fulfillmentStatus);
    const upcoming: TimelineNode[] = currentIndex >= 0
      ? FULFILLMENT_STEPS.slice(currentIndex + 1).map((step) => ({ step, state: 'pending' as const }))
      : [];

    return [...doneNodes, ...upcoming];
  }

  private stepFor(status: FulfillmentStatus): FulfillmentStep {
    return FULFILLMENT_STEPS.find((s) => s.status === status) ?? { status, label: status, statusLabel: status };
  }

  // ---- Workflow actions ----
  // Same transitions/copy as OrderWorkflowDialogComponent and
  // FulfillmentComponent - this is a third, deliberately independent copy
  // (matching this codebase's existing convention of each screen owning its
  // own thin action methods rather than a shared component - see
  // FulfillmentComponent's own methods) rather than a shared action
  // component to embed here.

  acknowledgeOrder(): void {
    this.service.acknowledgeOrder(this.selectedItem).then((saved) => {
      this.selectedItem.fulfillmentStatus = saved.fulfillmentStatus;
      this.selectedItem.statusHistory = saved.statusHistory;
      this.snackbar.success('Order acknowledged');
    });
  }

  async printShippingLabel(): Promise<void> {
    this.printing = true;
    try {
      await this.service.getShippingLabel(this.selectedItem);
    } finally {
      this.printing = false;
    }
  }

  markPickedUp(): void {
    this.service.markPickedUp(this.selectedItem).then((saved) => {
      this.selectedItem.fulfillmentStatus = saved.fulfillmentStatus;
      this.selectedItem.statusHistory = saved.statusHistory;
      this.snackbar.success('Marked as picked up / delivered - order closed');
    });
  }

  markPackaged(): void {
    this.service.markPackaged(this.selectedItem).then((saved) => {
      this.selectedItem.fulfillmentStatus = saved.fulfillmentStatus;
      this.selectedItem.statusHistory = saved.statusHistory;
      this.snackbar.success('Marked as packaged');
    });
  }

  markShipped(): void {
    this.service.markShipped(this.selectedItem).then((saved) => {
      this.selectedItem.fulfillmentStatus = saved.fulfillmentStatus;
      this.selectedItem.statusHistory = saved.statusHistory;
      this.snackbar.success('Marked as shipped - order closed');
    });
  }
}
