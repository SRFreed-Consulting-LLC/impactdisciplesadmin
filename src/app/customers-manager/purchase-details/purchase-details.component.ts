import { Component, Input } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { Timestamp } from 'firebase/firestore';
import { CartItem, CheckoutForm, FulfillmentStatus, PurchaseRefundEntry } from 'src/app/common/models/utils/cart.model';
import { PurchasesService } from 'src/app/common/services/data/purchases.service';
import { CustomerService } from 'src/app/common/services/data/customer.service';
import { EventService } from 'src/app/common/services/data/event.service';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { hasRole } from 'src/app/common/lists/roles.enum';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { FULFILLMENT_STEPS, FulfillmentStep } from '../fulfillment/fulfillment-steps';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { CustomerDetailsDialogComponent } from '../customers/customer-details-dialog.component';
import { RefundDialogComponent, RefundDialogData, RefundDialogResult } from './refund-dialog.component';

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
// customer & address panel, order-total stat tiles, a real discount-source
// breakdown, an order timeline, and the item list, per the reviewed mockup -
// https://claude.ai/code/artifact/adb6fa1b-28fa-4f50-9901-113f2730e0c8
// (merge of that gallery's "Stat Tiles" + "Timeline" concepts -
// https://claude.ai/code/artifact/bc048b67-a51f-49d0-85d2-47ab5fea23e6).
// The per-line-item refund action (refundLineItem) is fully commented out in
// both the template and the TS of the original - not ported at all, nothing
// lost since it was unreachable there either.
//
// Addresses & phone, 2026-08-13 update: now that every purchase upserts a
// customer record (functions/src/customer-upsert.functions.ts), all
// contact-info editing moved off this screen entirely and onto that
// customer record instead - see cart.model.ts's own comment. Customer/
// Billing/Shipping render side by side, all read-only; "View Customer
// Record" opens the real record to review/correct there.
@Component({
    selector: 'app-purchase-details',
    templateUrl: './purchase-details.component.html',
    styleUrls: ['./purchase-details.component.scss'],
    standalone: false
})
export class PurchaseDetailsComponent {
  @Input() selectedItem: CheckoutForm;

  // Was read fresh via authService.getLoggedInUser().role on every
  // isVisible() call - see events.component.ts for the full explanation
  // (a stale/expired role cookie throwing on a valid Firebase session).
  currentUserRole?: string;

  printing = false;
  viewingCustomer = false;
  refunding = false;

  constructor(
    public service: PurchasesService,
    private authService: AdminAuthService,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService,
    private customerService: CustomerService,
    private eventService: EventService,
    private dialog: MatDialog
  ) {
    this.authService.dao.loggedInUser$.subscribe((user) => {
      this.currentUserRole = user?.role;
    });
  }

  isVisible(roles: string[]): boolean {
    return hasRole(this.currentUserRole, roles);
  }

  // ---- Refund ----

  canRefund(): boolean {
    return this.isVisible(['Admin']) &&
      !this.selectedItem.refunded &&
      !!this.selectedItem.id &&
      this.service.getRemainingRefundable(this.selectedItem) > 0;
  }

  private hasDigitalItems(): boolean {
    return (this.selectedItem.cartItems ?? [])
      .some(item => item.isDigitalBook || item.isEBook);
  }

  // Whether a real PayPal charge exists to partially refund - mirrors the
  // server's needsPaypalRefund gate ($0/coupon orders can only be marked
  // fully refunded, no amount entry).
  private allowPartial(): boolean {
    const receipt = (this.selectedItem.receipt ?? '').trim();
    return (this.selectedItem.total ?? 0) > 0 &&
      receipt !== '' && receipt !== 'COUPON' && receipt !== 'FREE ONLY';
  }

  // The refunds history the timeline card renders - legacy fully-refunded
  // purchases (pre-refunds[]) get one synthesized row from refundedAt/
  // refundedBy so their history isn't blank.
  refundHistory(): PurchaseRefundEntry[] {
    const refunds = this.selectedItem.refunds ?? [];
    if (refunds.length === 0 && this.selectedItem.refunded) {
      return [{
        amount: this.selectedItem.refundAmount || this.service.getChargedDisplayAmount(this.selectedItem),
        date: this.selectedItem.refundedAt as Timestamp,
        ...(this.selectedItem.refundedBy ? { by: this.selectedItem.refundedBy } : {}),
        ...(this.selectedItem.refundId ? { refundId: this.selectedItem.refundId } : {})
      }];
    }
    return refunds;
  }

  async openRefundDialog(): Promise<void> {
    if (this.refunding) {
      return;
    }
    const remaining = this.service.getRemainingRefundable(this.selectedItem);
    const data: RefundDialogData = {
      remaining,
      alreadyRefunded: this.selectedItem.refundAmount ?? 0,
      email: this.selectedItem.email,
      hasDigitalItems: this.hasDigitalItems(),
      allowPartial: this.allowPartial(),
    };
    const result = await firstValueFrom(
      this.dialog
        .open<RefundDialogComponent, RefundDialogData, RefundDialogResult>(RefundDialogComponent, { data, width: '480px' })
        .afterClosed()
    );
    if (!result?.confirmed) {
      return;
    }
    this.refunding = true;
    try {
      const isFull = Math.round(result.amount * 100) === Math.round(remaining * 100);
      const outcome = await this.service.refundPurchase(
        this.selectedItem.id, result.revokeLicenses, isFull ? undefined : result.amount
      );
      // Update local state from the callable's answer - no refetch needed.
      this.selectedItem.refundAmount = outcome.refundAmount;
      this.selectedItem.refunds = [
        ...(this.selectedItem.refunds ?? []),
        {
          amount: isFull ? remaining : result.amount,
          date: Timestamp.now(),
          ...(outcome.refundId ? { refundId: outcome.refundId } : {})
        }
      ];
      if (outcome.fullyRefunded) {
        this.selectedItem.refunded = true;
      }
      if (outcome.fulfillmentClosed) {
        this.selectedItem.fulfillmentStatus = 'closed';
        this.selectedItem.statusHistory = [
          ...(this.selectedItem.statusHistory ?? []),
          { status: 'closed', date: Timestamp.now() }
        ];
      }
      this.snackbar.success(
        (outcome.fullyRefunded ?
          (outcome.paypalRefunded ? 'Full refund issued through PayPal - order closed.' : 'Order marked refunded (no payment was taken).') :
          `Partial refund of $${result.amount.toFixed(2)} issued through PayPal - order stays open.`) +
        (outcome.revokedBookIds.length > 0 ? ` ${outcome.revokedBookIds.length} library license(s) revoked.` : '')
      );
    } catch (err) {
      this.snackbar.error('Refund failed: ' + ((err as Error)?.message ?? 'unknown error'));
    } finally {
      this.refunding = false;
    }
  }

  // ---- Addresses ----

  customerName(): string {
    return [this.selectedItem.firstName, this.selectedItem.lastName].filter(Boolean).join(' ') || this.selectedItem.email || 'Unknown';
  }

  phoneDisplay(): string {
    const phone = this.selectedItem.phone;
    return phone?.number ? [phone.countryCode, phone.number].filter(Boolean).join(' ') : '—';
  }

  // Looks the customer up by email (same lowercased/trimmed match key
  // onPurchaseCustomerUpsert writes with - see its own comment) rather than
  // storing a customerId anywhere; opens the same app-customer-details
  // CustomersComponent's own row double-click does, just wrapped in a
  // dialog here (see CustomerDetailsDialogComponent's own comment) so this
  // screen's own in-progress edit isn't lost underneath it. Sized generously
  // rather than the old CustomerDialogComponent's 1200px/95vw cap - that
  // cap was sized for a 6-tab layout this screen no longer has. Events are
  // fetched here too (app-customer-details needs them for its merged
  // activity feed) - a small duplicate live call rather than plumbing them
  // all the way down from PurchasesComponent for a link that's clicked
  // occasionally, not on every page load.
  async viewCustomer(): Promise<void> {
    if (!this.selectedItem.email || this.viewingCustomer) {
      return;
    }
    this.viewingCustomer = true;
    try {
      const email = this.selectedItem.email.trim().toLowerCase();
      const [customers, events] = await Promise.all([
        this.customerService.getAllByValue('email', email),
        this.eventService.getAll()
      ]);
      const customer = customers[0];
      if (!customer) {
        this.snackbar.error('No customer record found for this email yet.');
        return;
      }
      this.dialog.open(CustomerDetailsDialogComponent, {
        width: '95vw',
        maxWidth: '1400px',
        height: '90vh',
        maxHeight: '900px',
        data: { item: customer, events }
      });
    } finally {
      this.viewingCustomer = false;
    }
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
