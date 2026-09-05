import { Injectable } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Timestamp } from 'firebase/firestore';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { CartItem, CheckoutForm, FulfillmentStatus, StatusHistoryEntry } from '@impact-common/shared/models/utils/cart.model';
import { dateFromTimestamp } from '@impact-common/shared/utils/date-from-timestamp';
import { environment } from 'src/environments/environment';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { SnackbarService } from 'src/app/shared/snackbar.service';
import { AMAZON_FULFILLMENT_STEPS, FULFILLMENT_STEPS } from 'src/app/shared/fulfillment/fulfillment-steps';
import { renderMergeTags } from 'src/app/common/utils/email/merge-tags';
import { BaseService } from './base.service';
import { EMailService } from './email.service';
import { EMailTemplatesService } from './email-templates.service';
import { MailTemplateModel } from 'src/app/common/models/admin/mail.model';
import { CALLABLE_FUNCTIONS } from '@impact-common/shared/contract/functions-contract';
import {
  ShippingCostDrift,
  WithShippingCostDrift
} from 'src/app/common/models/domain/shipping-cost-drift.model';
import {
  RefundStorePurchaseRequest,
  RefundStorePurchaseResult,
} from '@impact-common/shared/contract/admin-callables.types';

// The mail_templates doc sendAmazonConfirmation() renders - looked up BY
// NAME, same load-bearing-name convention as the "Sales Receipt" template
// (see CLAUDE.md's email taxonomy note). Seeded by
// scripts/seed-amazon-confirmation-template.js; editable in the designer.
export const AMAZON_CONFIRMATION_TEMPLATE_NAME = 'Amazon Shipping Confirmation';

/**
 * The PINNED document id for that template - the handle that cannot be
 * edited, unlike the name above.
 *
 * Mirror of MAIL_TEMPLATE_IDS in
 * functions/src/utils/mail-templates.functions.ts; the two npm projects
 * share no modules, so keep them in step. The documents are re-created under
 * these ids by scripts/pin-template-ids.js, once per project - Firestore
 * cannot rename a document, and the ids they were originally created with
 * differ between dev and prod.
 */
export const AMAZON_CONFIRMATION_TEMPLATE_ID = 'tmpl-amazon-shipping-confirmation';
export const SALES_RECEIPT_TEMPLATE_ID = 'tmpl-sales-receipt';

// The store receipt every completed checkout sends. NOT sent from this app at
// all - functions/src/transactional-emails.ts looks it up by this literal
// name server-side. Declared here anyway so the admin UI can offer to edit
// it from a purchase, and so the name exists in one findable place on this
// side; if the two ever disagree, the receipt silently stops going out.
export const SALES_RECEIPT_TEMPLATE_NAME = 'Sales Receipt';

// refundStorePurchase's response shape (functions/src/store-refund.functions.ts).
/** Alias of the shared contract's RefundStorePurchaseResult (Stage 2e-ii). */
export type RefundResult = RefundStorePurchaseResult;

@Injectable({
  providedIn: 'root'
})
export class PurchasesService extends BaseService<CheckoutForm>{
  constructor(
    public override dao: FirebaseDAO<CheckoutForm>,
    private authService: AdminAuthService,
    private snackbar: SnackbarService,
    private emailService: EMailService,
    private emailTemplatesService: EMailTemplatesService,
    private functions: Functions
  ) {
    super(dao)
    this.table="purchases"
    this.fromFirestore = PurchasesService.fromFirestore
  }

  static readonly fromFirestore = (data: CheckoutForm): CheckoutForm => {
    data.dateProcessed = dateFromTimestamp(data.dateProcessed as Timestamp)

    return data;
  };

  /** Refund via the refundStorePurchase Cloud Function - the full
   *  remaining amount when `amount` is omitted, or an admin-chosen partial
   *  (dollars). PayPal capture refund happens server-side; $0 coupon
   *  orders just get marked. revokeLicenses is the refund dialog's "also
   *  revoke library access" checkbox - full refunds only, admin's call. */
  async refundPurchase(
    purchaseId: string,
    revokeLicenses: boolean,
    amount?: number
  ): Promise<RefundResult> {
    const fn = httpsCallable<RefundStorePurchaseRequest, RefundStorePurchaseResult>(this.functions, CALLABLE_FUNCTIONS.refundStorePurchase);
    const result = await fn({ purchaseId, revokeLicenses, ...(amount != null ? { amount } : {}) });
    return result.data;
  }

  /** Shared by the purchase-details pills, the workflow dialog, and any
   *  other refund-state badge - one definition of what the two states mean:
   *  `refunded` = fully refunded; a nonzero refundAmount without it = a
   *  partial refund so far. */
  getRefundStateLabel(item: CheckoutForm): 'REFUNDED' | 'PARTIALLY REFUNDED' | null {
    if (item.refunded) {
      return 'REFUNDED';
    }
    return (item.refundAmount ?? 0) > 0 ? 'PARTIALLY REFUNDED' : null;
  }

  /** Dollars still refundable on this purchase (charged minus cumulative
   *  refunds, floored at 0) - drives canRefund() and the dialog's amount
   *  validation. Cents-rounded to dodge float dust. */
  getRemainingRefundable(item: CheckoutForm): number {
    const chargedCents = Math.round(this.getChargedDisplayAmount(item) * 100);
    const refundedCents = Math.round((item.refundAmount ?? 0) * 100);
    return Math.max(0, chargedCents - refundedCents) / 100;
  }

  // Appends one entry to the Sale Details tab's timeline (see
  // StatusHistoryEntry's own comment, cart.model.ts) - every transition
  // method below folds this into the same full-object update() that changes
  // fulfillmentStatus itself, so the two can never drift apart.
  //
  // `by` is only set when currentUserLabel() has a real value - live-
  // diagnosed 2026-08-14: `by` is typed optional (`by?: string`) but
  // currentUserLabel() can return `undefined` (the display-caching cookie
  // it reads can be missing/expired independently of the real Firebase Auth
  // session - see its own comment), and an object literal with a key
  // explicitly set to `undefined` is NOT the same thing as that key being
  // absent - Firestore's setDoc() rejects the whole write ("Unsupported
  // field value: undefined") the moment any field, however deeply nested,
  // is explicitly undefined. Every fulfillment-status transition button
  // silently failed this way whenever the cookie had lapsed. Omitting the
  // key entirely when there's no label keeps the entry itself valid.
  private withStatusHistory(item: CheckoutForm, status: FulfillmentStatus): StatusHistoryEntry[] {
    const by = this.currentUserLabel();
    const entry: StatusHistoryEntry = { status, date: Timestamp.now(), ...(by ? { by } : {}) };
    return [...(item.statusHistory ?? []), entry];
  }

  // getLoggedInUser() reads the client-side display-caching cookie (see
  // AdminAuthService's own SECURITY comment) - fine here, this only ever
  // labels a timeline entry with "who did this", it's not an auth decision.
  private currentUserLabel(): string | undefined {
    const user = this.authService.getLoggedInUser();
    return user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email : undefined;
  }

  calculateProductCostAmount(cartItem: { data: CartItem }){
      return cartItem.data.salePrice ? cartItem.data.salePrice : cartItem.data.price;
  }
  calculateItemTotalAmount(cartItem: { data: CartItem }, selectedItem: CheckoutForm){
    const totalPrice = (cartItem.data.salePrice ? cartItem.data.salePrice : cartItem.data.price) ?? 0;
    const quantity = cartItem.data.orderQuantity ?? 0;
    const discount = cartItem.data.discount ? cartItem.data.discount : 0;
    const shippingAmount = cartItem.data.isEvent? 0 : this.calculateItemShippingAmount(cartItem, selectedItem);
    const taxAmount = this.calculateItemTaxableAmount(cartItem, selectedItem);

    const amountToRefund: number  = ((totalPrice - discount) * quantity) + (shippingAmount? shippingAmount : 0) + (taxAmount ? taxAmount : 0);

    return amountToRefund;
  }

  calculateItemTaxableAmount(cartItem: { data: CartItem }, selectedItem: CheckoutForm){
    return (!cartItem.data.isEvent? ((cartItem.data.price ?? 0) * (cartItem.data.orderQuantity ?? 0)) * (selectedItem.taxRate ?? 0) : 0);
  }

  calculateItemShippingAmount(cartItem: { data: CartItem }, selectedItem: CheckoutForm){
    if(!cartItem.data.isEvent){
      let totalWeight: number;
      try{
        totalWeight = (selectedItem.cartItems ?? []).filter(item => item.isEvent == false).map(item => item.weight? item.weight : 0).reduce((a,b) => a + b);
      } catch (err){
        console.error(err)
        totalWeight = 0;
      }
      return ((selectedItem.shippingRate ?? 0) - (selectedItem.shippingDiscount ?? 0)) * parseFloat(((cartItem.data.weight ?? 0) / totalWeight).toFixed(2));
    } else {
      return 0;
    }
  }

  calculateItemDiscountAmount(cartItem: { data: CartItem }){
    const discountAmount = ((cartItem.data.price ?? 0) - (cartItem.data.discountPrice ?? 0)) * (cartItem.data.orderQuantity ?? 0)

    return discountAmount && discountAmount > 0 ? discountAmount : 0;
  }

  // ---- Display amounts ----
  // Real dollar amounts come from the PayPal receipt when present, falling
  // back to the general order-total fields the storefront's checkout writes
  // on every purchase regardless of payment method. Shared by the Purchases
  // list columns, its edit-view summary block, and the Sale Details tab's
  // stat tiles (purchase-details.component.ts) - moved here (out of
  // PurchasesComponent, which used to own all six) so all three render the
  // exact same figures instead of three copies of this math drifting apart.
  getProductTotalDisplayAmount(item: CheckoutForm): number {
    return item.payPalReceipt ? parseFloat(item.payPalReceipt.purchase_units?.[0]?.amount?.breakdown?.item_total?.value ?? '') : (item.total ?? 0) > 0 ? item.total! : 0;
  }

  getDiscountDisplayAmount(item: CheckoutForm): number {
    const discount = item.payPalReceipt?.purchase_units?.[0]?.amount?.breakdown?.discount;
    return discount
      ? parseFloat(discount.value)
      : (item.discount ?? 0) > 0
        ? item.discount!
        : 0;
  }

  getTaxesDisplayAmount(item: CheckoutForm): number {
    return item.payPalReceipt ? parseFloat(item.payPalReceipt.purchase_units?.[0]?.amount?.breakdown?.tax_total?.value ?? '') : (item.estimatedTaxes ?? 0) > 0 ? item.estimatedTaxes! : 0;
  }

  getShippingDisplayAmount(item: CheckoutForm): number {
    return item.payPalReceipt ? parseFloat(item.payPalReceipt.purchase_units?.[0]?.amount?.breakdown?.shipping?.value ?? '') : item.shippingRate ? item.shippingRate : 0;
  }

  getShippingDiscountDisplayAmount(item: CheckoutForm): number {
    return item.payPalReceipt ? parseFloat(item.payPalReceipt.purchase_units?.[0]?.amount?.breakdown?.shipping_discount?.value ?? '') : (item.shippingDiscount ?? 0) > 0 ? item.shippingDiscount! : 0;
  }

  getChargedDisplayAmount(item: CheckoutForm): number {
    if (item.payPalReceipt) {
      return parseFloat(item.payPalReceipt.purchase_units?.[0]?.amount?.value ?? '');
    }

    // 2026-08-12 fullsweep fix: this used to be a single ternary that
    // computed (total - discount) only to test its sign, then returned the
    // un-discounted item.total! regardless - every non-PayPal order's
    // "Charged" figure (list column + Admin summary row via sumOf('charged'))
    // was overstated by exactly the discount amount.
    const charged = (item.total ?? 0) - (item.discount ?? 0);
    return charged > 0 ? charged : 0;
  }

  // Falls back to fulfillmentStatus's human label for non-PayPal orders -
  // was a Stripe paymentIntent.status fallback before Stripe support was
  // removed from this app (Stripe is still used by the storefront's own
  // /give donation flow and by this repo's Cloud Functions, just not read/
  // displayed here anymore), then a processedStatus (NEW/COMPLETE/REFUNDED)
  // fallback before that field was removed entirely.
  getOrderStatusDisplay(item: CheckoutForm): string {
    return item.payPalReceipt ? (item.payPalReceipt.status ?? '') : this.getFulfillmentStatusLabel(item.fulfillmentStatus);
  }

  getFulfillmentStatusLabel(status: FulfillmentStatus | undefined): string {
    return [...FULFILLMENT_STEPS, ...AMAZON_FULFILLMENT_STEPS]
      .find((s) => s.status === status)?.statusLabel ?? 'Unknown';
  }

  calculateOrderRefundedAmount(selectedItem: CheckoutForm){
    const refundedItems = (selectedItem.cartItems ?? []).filter(item => item.processedStatus == "REFUNDED");
    const totalRefundedList: number[] = refundedItems.map(item => this.calculateItemTotalAmount({data: item}, selectedItem));

    if(totalRefundedList && totalRefundedList.length > 0){
      return Number(totalRefundedList.reduce((a,b) => a + b).toFixed(2));
    } else {
      return  Number(Number(0).toFixed(0));

    }
  }

  // Moved here from PurchasesComponent (which now just delegates) so the
  // Fulfillment screen can trigger the exact same real action - purchasing
  // a shipping label costs real postage, this endpoint requires a verified
  // staff Firebase ID token (see requireStaffAuth() on the Cloud Function
  // side). If this is the order's first successful label, also advances
  // fulfillmentStatus 'received' -> 'shipping_label_printed' (step 3 of the
  // Fulfillment workflow) as part of the same write - see cart.model.ts's
  // own comment on that field for why it's a separate concern from this
  // method's primary job of getting the label downloaded.
  //
  // A FAILED ATTEMPT IS NOT A LABEL. Until 2026-09-02 a failure was assigned
  // to item.shippingLabel just like a success, which had two consequences,
  // both live: every later click took the "already has a label" branch and
  // re-printed the stale message without retrying, and because update() is a
  // whole-document setDoc of `item`, the very next workflow action (Received,
  // Packaged) persisted the error blob onto the purchase - after which the
  // order could never be labelled again from any screen. Four purchases on
  // dev are in exactly that state. A failure now leaves the field alone, and
  // a stored failure is treated as no label so the retry can happen.
  async getShippingLabel(item: CheckoutForm): Promise<void> {
    // A stored error (from before that fix, or written by an older client)
    // must not block a retry - it is a record of a failure, not a label.
    if (item.shippingLabel?.code || item.shippingLabel?.error) {
      // DELETE, never `= undefined`. `item` is the live object the grid holds,
      // and every workflow action passes it on as `{ ...item, ... }` to
      // update(), which is a whole-document setDoc with no merge. Object
      // spread PRESERVES an own key whose value is undefined, so assigning it
      // here left the next markPackaged/markShipped rejecting the entire
      // write with "Unsupported field value: undefined" - the same failure
      // this method's own comment above was written to fix, arriving by a
      // different door. Fixed 2026-09-05.
      delete item.shippingLabel;
    }

    if (!item.shippingLabel) {
      const idToken = await this.authService.dao.auth.currentUser?.getIdToken();

      const request = await fetch(environment.shippingLabelUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
        // Sweep finding S3: the purchase ID, NOT the rate id quoted at
        // checkout. The function builds the shipment from this purchase's
        // own stored address and its products' weights, so a rate id an
        // anonymous caller planted at checkout can no longer decide where
        // the org's postage goes. item.shippingRateId is still stored on
        // the purchase (its amount is what the customer was charged) but
        // is no longer used to buy anything.
        body: JSON.stringify({ purchaseId: item.id })
      });

      const response = await request.json();

      // Any error code, not just 400 - the function answers 502 when the
      // vendor itself fails, and treating that as success used to send an
      // error payload down the download path and blow up on an undefined
      // labelDownload.
      if (!request.ok || response.code >= 400) {
        // Deliberately NOT assigned to item.shippingLabel - see the note on
        // this method. The order stays retryable, and nothing writes a
        // failure onto the purchase document.
        this.snackbar.error(response.error?.message ?? 'Failed to buy a shipping label.');
      } else {
        item.shippingLabel = response;
        // The function has already written the drift to the purchase.
        // Carry it onto the in-memory copy BEFORE the update below, which
        // is a whole-document setDoc - without this it would immediately
        // overwrite the record the server just made.
        const drift = (response as { shippingCostDrift?: ShippingCostDrift }).shippingCostDrift;
        if (drift) {
          (item as WithShippingCostDrift<CheckoutForm>).shippingCostDrift = drift;
        }
        if (item.fulfillmentStatus === 'received') {
          item.fulfillmentStatus = 'shipping_label_printed';
          item.statusHistory = this.withStatusHistory(item, 'shipping_label_printed');
        }
        this.update(item.id!, item).then((saved) => {
          const pdf = saved.shippingLabel?.labelDownload?.pdf;
          if (pdf) {
            this.downloadShippingLabel(pdf);
          }
        });
      }
    } else if (item.shippingLabel?.labelDownload?.pdf) {
      this.downloadShippingLabel(item.shippingLabel.labelDownload.pdf);
    } else {
      // A label with no download link is not something to re-download and
      // not something to retry silently - say so rather than throwing on an
      // undefined pdf, which is what this branch used to do.
      this.snackbar.error('This order has a label on file with no download link.');
    }
  }

  private downloadShippingLabel(pdf: string): void {
    const link = document.createElement('a');
    link.setAttribute('target', '_blank');
    link.setAttribute('href', pdf);
    link.setAttribute('download', 'shipping-label.pdf');
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  // ---- Fulfillment workflow manual transitions (Store Manager > Fulfillment) ----
  // Each is a full-object-spread update() call - FirebaseDAO.update() is a
  // full setDoc (no merge), same pattern as every other write site.

  // Step 2: admin acknowledges a freshly-arrived order. 'new' -> 'received'.
  acknowledgeOrder(item: CheckoutForm): Promise<CheckoutForm> {
    return this.update(item.id!, { ...item, fulfillmentStatus: 'received', statusHistory: this.withStatusHistory(item, 'received') });
  }

  // Override for orders picked up in person or hand-delivered - they never
  // get a shipping label or a separate packaging step, so this jumps
  // straight from 'received' to 'closed', skipping shipping_label_printed
  // and awaiting_shipping entirely.
  markPickedUp(item: CheckoutForm): Promise<CheckoutForm> {
    return this.update(item.id!, { ...item, fulfillmentStatus: 'closed', statusHistory: this.withStatusHistory(item, 'closed') });
  }

  markPackaged(item: CheckoutForm): Promise<CheckoutForm> {
    return this.update(item.id!, { ...item, fulfillmentStatus: 'awaiting_shipping', statusHistory: this.withStatusHistory(item, 'awaiting_shipping') });
  }

  markShipped(item: CheckoutForm): Promise<CheckoutForm> {
    return this.update(item.id!, { ...item, fulfillmentStatus: 'closed', statusHistory: this.withStatusHistory(item, 'closed') });
  }

  // The Amazon branch taken from 'received' (2026-08-19): Amazon ships the
  // order, so there's no label/packaging - the remaining work is telling
  // the customer.
  markShippedViaAmazon(item: CheckoutForm): Promise<CheckoutForm> {
    return this.update(item.id!, { ...item, fulfillmentStatus: 'shipped_via_amazon', statusHistory: this.withStatusHistory(item, 'shipped_via_amazon') });
  }

  /**
   * Loads the Amazon Shipping Confirmation template.
   *
   * By pinned ID first: a name is an editable text field, and renaming this
   * template used to stop the shipping confirmation with no error anywhere.
   * The name lookup stays as a fallback so a project whose data has not been
   * pinned yet still sends. THROWS when nothing resolves - unlike the receipt
   * path, the admin is standing right here and the order must not close as
   * "confirmation sent" when none was.
   * @returns The template document.
   */
  async loadAmazonConfirmationTemplate(): Promise<MailTemplateModel> {
    const byId = await this.emailTemplatesService.getById(AMAZON_CONFIRMATION_TEMPLATE_ID);
    const template = byId
      ?? (await this.emailTemplatesService.getAllByValue('name', AMAZON_CONFIRMATION_TEMPLATE_NAME))[0];
    if (!template) {
      throw new Error(
        `Email template "${AMAZON_CONFIRMATION_TEMPLATE_NAME}" not found - ` +
        'create it under Store Manager, or run scripts/pin-template-ids.js.'
      );
    }
    return template;
  }

  /** The merge values this email resolves, per purchase. */
  amazonConfirmationContext(item: CheckoutForm): Record<string, string> {
    return {
      firstName: item.firstName ?? '',
      lastName: item.lastName ?? '',
      email: (item.email ?? '').trim(),
      date: new Date().toLocaleDateString('en-US')
    };
  }

  // The Amazon path's final step: send the customer their confirmation and
  // close the order in one action.
  //
  // 2026-09-04: `prepared` replaced a `tracking` argument. The dialog now shows
  // the real email and lets the admin edit its wording per order, so the
  // caller arrives with finished content rather than one value to merge.
  //
  // The tracking argument is gone rather than merely unused, and it is worth
  // knowing why: the template contains ONE merge tag, *|FNAME|*. There is no
  // *|TRACKING|*, and there never was - so every tracking number typed into
  // that prompt was merged into a context nothing read, and no customer ever
  // received one. It was still stored on the purchase as `amazonTracking`, and
  // those historical values are left untouched; nothing writes the field now.
  //
  // Still throws before any state change when the purchase has no email
  // address, so an order cannot close as "confirmation sent" when none was.
  async sendAmazonConfirmation(
    item: CheckoutForm,
    prepared?: { subject: string; html: string }
  ): Promise<CheckoutForm> {
    const email = (item.email ?? '').trim();
    if (!email.includes('@')) {
      throw new Error('This purchase has no contact email address.');
    }

    // Falling back to the stored template keeps every caller that has not been
    // given an editor working - and means a failure to build the preview can
    // never leave an order unsendable.
    let subject = prepared?.subject;
    let html = prepared?.html;
    if (!subject || !html) {
      const template = await this.loadAmazonConfirmationTemplate();
      const context = this.amazonConfirmationContext(item);
      html = renderMergeTags(template.html ?? '', context);
      subject = renderMergeTags(template.subject || 'Your order is on its way!', context);
    }

    await this.emailService.sendHtmlEmail(email, subject, html);

    return this.update(item.id!, {
      ...item,
      fulfillmentStatus: 'closed',
      statusHistory: this.withStatusHistory(item, 'closed')
    });
  }

  /**
   * Closes an Amazon order WITHOUT emailing the customer.
   *
   * The sibling of sendAmazonConfirmation for the case where the customer has
   * already been told some other way, or does not need telling. It is a
   * separate method rather than a flag because the two differ in the thing
   * that matters: one of them sends mail on the ministry's domain and the
   * other cannot.
   *
   * The status change is recorded in statusHistory exactly like the sending
   * path, so the timeline still shows who closed the order and when.
   * @param item The purchase to close.
   * @returns The saved purchase.
   */
  closeWithoutConfirmation(item: CheckoutForm): Promise<CheckoutForm> {
    return this.update(item.id!, {
      ...item,
      fulfillmentStatus: 'closed',
      statusHistory: this.withStatusHistory(item, 'closed')
    });
  }

  // Corrective back-step (purchase screen only): returns the order to an
  // earlier workflow step - including reopening a closed order - with the
  // move recorded in statusHistory like any forward transition, so the
  // timeline shows exactly who moved it and when.
  revertStatus(item: CheckoutForm, status: FulfillmentStatus): Promise<CheckoutForm> {
    return this.update(item.id!, { ...item, fulfillmentStatus: status, statusHistory: this.withStatusHistory(item, status) });
  }
}
