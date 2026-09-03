import { Component, Input} from '@angular/core';
import { customerName as customerNameOf } from 'src/app/contacts-manager/fulfillment/order-display.util';
import { MatDialog } from '@angular/material/dialog';
import { filter, firstValueFrom, take } from 'rxjs';
import { Timestamp } from 'firebase/firestore';
import { CartItem, CheckoutForm } from '@impact-common/shared/models/utils/cart.model';
import { AMAZON_CONFIRMATION_TEMPLATE_NAME, PurchasesService } from 'src/app/common/services/data/purchases.service';
import { EmailTemplateEditorService } from 'src/app/common/services/email-template-editor.service';
import { ContactService } from 'src/app/common/services/data/contact.service';
import { EventService } from 'src/app/common/services/data/event.service';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { hasRole } from '@impact-common/shared/lists/roles.enum';
import { dateFromTimestamp } from '@impact-common/shared/utils/date-from-timestamp';
import { FulfillmentStep, WorkflowAction, stepsFor } from '../fulfillment/fulfillment-steps';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { AmazonConfirmationDialogComponent } from '../../shared/amazon-confirmation-dialog/amazon-confirmation-dialog.component';
import { ContactDetailsDialogComponent } from '../contacts/contact-details-dialog.component';
import { RefundDialogComponent, RefundDialogData, RefundDialogResult } from './refund-dialog.component';

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

  // The workflow action in flight, if any - every action-bar button disables
  // while one is, and the pressed one shows a spinner. See run().
  busy: WorkflowAction | null = null;
  viewingCustomer = false;
  refunding = false;

  constructor(
    public service: PurchasesService,
    private authService: AdminAuthService,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService,
    private customerService: ContactService,
    private eventService: EventService,
    private dialog: MatDialog
    , private templateEditor: EmailTemplateEditorService
  ) {
    // Sweep finding A2. loggedInUser$ is shared with
    // resetOnRefCountZero: false on a root service, so its connector keeps
    // its observer list for the whole session - nothing evicts a
    // subscriber that never unsubscribes. Without take(1) every
    // PurchaseDetailsComponent opened this session stayed reachable, with
    // its state and template refs, re-running this callback on every auth
    // re-emit. (Untorn-down ActivatedRoute subscriptions elsewhere are
    // fine for the opposite reason: the router completes those with the
    // route. This subject is deliberately session-scoped.)
    //
    // Only the first real user is needed, so no ngOnDestroy is required.
    this.authService.dao.loggedInUser$
      .pipe(filter((user) => !!user), take(1))
      .subscribe((user) => {
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
  // server's needsPaypalRefundFor() gate ($0/coupon orders can only be
  // marked fully refunded, no amount entry). A coupon-covered order's
  // receipt IS its coupon code since 2026-09-03 (the literal 'COUPON' is
  // the pre-backfill form), so the receipt is compared against the
  // order's own couponCode rather than against a sentinel word.
  private allowPartial(): boolean {
    const receipt = (this.selectedItem.receipt ?? '').trim();
    const couponCode = (this.selectedItem.couponCode ?? '').trim();
    const isCouponReceipt =
      receipt === 'COUPON' || (couponCode !== '' && receipt.toLowerCase() === couponCode.toLowerCase());
    return (this.selectedItem.total ?? 0) > 0 && receipt !== '' && receipt !== 'FREE ONLY' && !isCouponReceipt;
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
    return customerNameOf(this.selectedItem);
  }

  phoneDisplay(): string {
    const phone = this.selectedItem.phone;
    return phone?.number ? [phone.countryCode, phone.number].filter(Boolean).join(' ') : '—';
  }

  // Looks the customer up by email (same lowercased/trimmed match key
  // onPurchaseCustomerUpsert writes with - see its own comment) rather than
  // storing a customerId anywhere; opens the same app-contact-details
  // ContactsComponent's own row double-click does, just wrapped in a
  // dialog here (see ContactDetailsDialogComponent's own comment) so this
  // screen's own in-progress edit isn't lost underneath it. Sized generously
  // rather than the old CustomerDialogComponent's 1200px/95vw cap - that
  // cap was sized for a 6-tab layout this screen no longer has. Events are
  // fetched here too (app-contact-details needs them for its merged
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
        this.snackbar.error('No contact record found for this email yet.');
        return;
      }
      this.dialog.open(ContactDetailsDialogComponent, {
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

  // ---- Workflow actions ----
  // Same transitions/copy as OrderWorkflowDialogComponent and
  // FulfillmentComponent - this is a third, deliberately independent copy
  // (matching this codebase's existing convention of each screen owning its
  // own thin action methods rather than a shared component - see
  // FulfillmentComponent's own methods) rather than a shared action
  // component to embed here.

  acknowledgeOrder(): void {
    void this.transition('acknowledge', () => this.service.acknowledgeOrder(this.selectedItem), 'Order acknowledged');
  }

  // No success snackbar: the label PDF opening in a new tab IS the result.
  printShippingLabel(): Promise<void> {
    return this.run('print', () => this.service.getShippingLabel(this.selectedItem));
  }

  markPickedUp(): void {
    void this.transition('pickedUp', () => this.service.markPickedUp(this.selectedItem), 'Marked as picked up / delivered - order closed');
  }

  markPackaged(): void {
    void this.transition('packaged', () => this.service.markPackaged(this.selectedItem), 'Marked as packaged');
  }

  markShipped(): void {
    void this.transition('shipped', () => this.service.markShipped(this.selectedItem), 'Marked as shipped - order closed');
  }

  // The Amazon branch (2026-08-19 workflow change): Amazon does the
  // shipping; the final step is the customer confirmation email, which
  // closes the order.
  markShippedViaAmazon(): void {
    void this.transition('amazon', () => this.service.markShippedViaAmazon(this.selectedItem), 'Marked as shipped via Amazon');
  }

  // A status transition: the service returns the saved purchase, and its
  // status + history are copied back onto the bound item so the screen
  // updates without a refetch.
  private transition(
    action: WorkflowAction,
    work: () => Promise<CheckoutForm>,
    successMessage: string
  ): Promise<void> {
    return this.run(action, async () => {
      const saved = await work();
      this.selectedItem.fulfillmentStatus = saved.fulfillmentStatus;
      this.selectedItem.statusHistory = saved.statusHistory;
      this.snackbar.success(successMessage);
    });
  }

  // The one place a workflow action runs: mark busy, do the work, report,
  // and ALWAYS clear - so the spinner can never stick and a double-click
  // cannot fire the same transition twice. Until 2026-09-03 only Print
  // Label had any in-flight state here, and a rejected status write
  // vanished silently - no snackbar, nothing - which the other two workflow
  // surfaces had already fixed.
  private async run(action: WorkflowAction, work: () => Promise<unknown>): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = action;
    try {
      await work();
    } catch (err) {
      console.error('Fulfillment status update failed', err);
      this.snackbar.error("Couldn't update this order - please try again.");
    } finally {
      this.busy = null;
    }
  }

  // The template this workflow step sends, editable from here. Named by the
  // same constant PurchasesService looks it up by, so the two cannot drift.

  get canEditConfirmationEmail(): boolean {
    return this.templateEditor.canEdit();
  }

  editConfirmationEmail(): void {
    void this.templateEditor.openByName(AMAZON_CONFIRMATION_TEMPLATE_NAME, { from: 'fulfillment' });
  }

  sendAmazonConfirmation(): void {
    this.dialog.open<AmazonConfirmationDialogComponent, { item: CheckoutForm }, CheckoutForm | null>(
      AmazonConfirmationDialogComponent, { width: '520px', data: { item: this.selectedItem } }
    ).afterClosed().subscribe((saved) => {
      if (saved) {
        this.selectedItem.fulfillmentStatus = saved.fulfillmentStatus;
        this.selectedItem.statusHistory = saved.statusHistory;
        this.selectedItem.amazonTracking = saved.amazonTracking;
      }
    });
  }

  // ---- Back-step (this screen only, per the user 2026-08-19) ----
  // The earlier steps of THIS order's path (Amazon vs standard), most
  // recent first - including reopening a closed order. Every move is
  // recorded in statusHistory like a forward transition, so the timeline
  // shows exactly who moved it back and when.
  get backSteps(): FulfillmentStep[] {
    const path = stepsFor(this.selectedItem.fulfillmentStatus, this.selectedItem.statusHistory);
    const currentIndex = path.findIndex((s) => s.status === this.selectedItem.fulfillmentStatus);
    if (currentIndex <= 0) {
      return [];
    }
    return path.slice(0, currentIndex).reverse();
  }

  async revertTo(step: FulfillmentStep): Promise<void> {
    const reopening = this.selectedItem.fulfillmentStatus === 'closed';
    const confirmed = await this.confirmService.confirm(
      (reopening ? 'Reopen this order and return it' : 'Return this order') +
      ` to <b>${step.statusLabel}</b>? The move is recorded on the order's timeline.`,
      'Move Back a Step');
    if (!confirmed) {
      return;
    }
    this.service.revertStatus(this.selectedItem, step.status).then((saved) => {
      this.selectedItem.fulfillmentStatus = saved.fulfillmentStatus;
      this.selectedItem.statusHistory = saved.statusHistory;
      this.snackbar.success(`Order moved back to ${step.statusLabel}`);
    }).catch((err) => {
      console.error('Back-step failed', err);
      this.snackbar.error("Couldn't move this order back - please try again.");
    });
  }
}
