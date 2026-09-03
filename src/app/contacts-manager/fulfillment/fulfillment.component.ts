import { Component, OnInit} from '@angular/core';
import {
  customerName as customerNameOf,
  isNewOrder,
  itemSummary as itemSummaryOf,
} from './order-display.util';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, map, tap } from 'rxjs';
import { CheckoutForm } from '@impact-common/shared/models/utils/cart.model';
import { WhereFilterOperandKeys } from 'src/app/common/dao/firebase.dao';
import { AMAZON_CONFIRMATION_TEMPLATE_NAME, PurchasesService } from 'src/app/common/services/data/purchases.service';
import { EmailTemplateEditorService } from 'src/app/common/services/email-template-editor.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { toMillis } from '@impact-common/shared/utils/date-from-timestamp';
import { MatDialog } from '@angular/material/dialog';
import { SnackbarService } from '../../shared/snackbar.service';
import { AmazonConfirmationDialogComponent } from '../../shared/amazon-confirmation-dialog/amazon-confirmation-dialog.component';
import { FulfillmentStep, WorkflowAction, completedStepCount, segmentState, stepsFor } from './fulfillment-steps';

// Store Manager > Fulfillment - the 5-step physical-order workflow (see
// fulfillment-steps.ts). Only ever shows purchases with a fulfillmentStatus
// (set server-side, see functions/src/purchase-fulfillment.functions.ts,
// only for orders with a physical line item) that isn't 'closed' yet -
// closing an order is how it "leaves" this workflow; the underlying
// purchase record itself is untouched and still fully visible in the
// regular Purchases screen.
@Component({
    selector: 'app-fulfillment',
    templateUrl: './fulfillment.component.html',
    styleUrls: ['./fulfillment.component.scss'],
    standalone: false
})
export class FulfillmentComponent implements OnInit {
  orders$: Observable<CheckoutForm[]>;

  // House rule: loading spinner shown until first emission - see
  // contacts.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  // Set when streamAll()'s own retries are exhausted (see
  // FirebaseDAO.streamAll()'s onError param) - distinguishes "genuinely no
  // open orders" from "couldn't load", which otherwise render identically
  // (both end up as an empty orders$ emission). Also: once this fires the
  // underlying live listener has already completed, not paused - retry()
  // below re-subscribes from scratch rather than waiting for the old one to
  // recover.
  loadFailed$ = new BehaviorSubject<boolean>(false);

  // Which action is in flight, per order id. While an order has one, every
  // workflow button on its card is disabled and the pressed one shows a
  // spinner (see run() and the template). This used to track Print Label
  // only, as a bare disabled flag: the plain Firestore transitions had no
  // in-flight state at all, and a 1-3s ShipEngine purchase greyed out
  // silently - both read as "the click did nothing" (owner, 2026-09-03).
  busy = new Map<string, WorkflowAction>();

  isBusy(item: CheckoutForm): boolean {
    return this.busy.has(item.id!);
  }

  isDoing(item: CheckoutForm, action: WorkflowAction): boolean {
    return this.busy.get(item.id!) === action;
  }

  private readonly screenKey = 'contacts-manager.fulfillment';

  constructor(private service: PurchasesService, private permissionService: PermissionService, private snackbar: SnackbarService, private router: Router, private dialog: MatDialog, private templateEditor: EmailTemplateEditorService) {}

  // Path-aware per order (standard vs Amazon branch).
  stepsFor(item: CheckoutForm): FulfillmentStep[] {
    return stepsFor(item.fulfillmentStatus, item.statusHistory);
  }

  // Every action on this screen (acknowledge/print label/mark packaged,
  // shipped, or picked up) mutates an existing purchase's fulfillment
  // status - there's no add/delete concept here, just one "can I work this
  // workflow" edit permission the whole screen's action buttons share.
  canEdit(): boolean {
    return this.permissionService.canEdit(this.screenKey);
  }

  // "View purchase record" per card - deep-links into the Purchases tab's
  // edit view (same gate PurchasesComponent.showEditModal() applies, which
  // is a DIFFERENT screenKey than this screen's own).
  canViewPurchase(): boolean {
    return this.permissionService.canEdit('contacts-manager.purchases');
  }

  viewPurchase(item: CheckoutForm): void {
    this.router.navigate(['/contacts-manager'], {
      queryParams: { tab: 'purchases', purchaseId: item.id }
    });
  }

  ngOnInit(): void {
    this.loadOrders();
  }

  // Re-invokable (not just ngOnInit's one-shot setup) so retry() can
  // establish a brand new streamAll() subscription after a failure - see
  // loadFailed$'s own comment on why the old one can't just be waited out.
  loadOrders(): void {
    this.loading$.next(true);
    this.loadFailed$.next(false);

    // Scoped live query, not a streamAll() over the whole purchases
    // collection - matches the dashboard's Recent Orders query. Every
    // purchase always has a fulfillmentStatus (set server-side, see
    // purchase-fulfillment.functions.ts), so the '!= closed' query fully
    // replaces the old client-side "item.fulfillmentStatus && ... !== 'closed'"
    // filter - nothing comes back missing the field to filter out.
    this.orders$ = this.service.queryStreamByValue(
      'fulfillmentStatus', WhereFilterOperandKeys.notEqual, 'closed', undefined,
      () => this.loadFailed$.next(true)
    ).pipe(
      map((items) => items
        // 'new' orders always float to the top (the whole point of the
        // status - see fulfillment-steps.ts), then oldest-first within
        // each group so nothing already in progress gets buried by a
        // newer arrival.
        .sort((a, b) => this.newRank(a) - this.newRank(b) || toMillis(a.dateProcessed) - toMillis(b.dateProcessed))
      ),
      tap(() => this.loading$.next(false))
    );
  }

  retry(): void {
    this.loadOrders();
  }

  // Delegates to order-display.util.ts for the same reason segmentState
  // delegates to fulfillment-steps.ts - four surfaces show this order.
  isNew(item: CheckoutForm): boolean {
    return isNewOrder(item);
  }

  acknowledgeOrder(item: CheckoutForm): void {
    void this.run(item, 'acknowledge', () => this.service.acknowledgeOrder(item), 'Order acknowledged');
  }

  completedCount(item: CheckoutForm): number {
    return completedStepCount(this.stepsFor(item), item.fulfillmentStatus);
  }

  // Delegates to the shared free function (fulfillment-steps.ts) so this
  // and DashboardComponent's read-only Recent Orders preview render
  // identical bars off one definition - see that function's own comment.
  segmentState(item: CheckoutForm, index: number): 'done' | 'current' | 'pending' {
    return segmentState(this.stepsFor(item), item.fulfillmentStatus, index);
  }

  itemSummary(item: CheckoutForm): string {
    return itemSummaryOf(item);
  }

  customerName(item: CheckoutForm): string {
    return customerNameOf(item);
  }

  // No success snackbar: the label PDF opening in a new tab IS the result.
  // PurchasesService.getShippingLabel reports a vendor refusal itself.
  printShippingLabel(item: CheckoutForm): Promise<void> {
    return this.run(item, 'print', () => this.service.getShippingLabel(item));
  }

  markPickedUp(item: CheckoutForm): void {
    void this.run(item, 'pickedUp', () => this.service.markPickedUp(item), 'Marked as picked up / delivered - order closed');
  }

  markPackaged(item: CheckoutForm): void {
    void this.run(item, 'packaged', () => this.service.markPackaged(item), 'Marked as packaged');
  }

  markShipped(item: CheckoutForm): void {
    void this.run(item, 'shipped', () => this.service.markShipped(item), 'Marked as shipped - order closed');
  }

  // The Amazon branch (2026-08-19): Amazon does the shipping; the final
  // step is the customer confirmation email, which closes the order.
  markShippedViaAmazon(item: CheckoutForm): void {
    void this.run(item, 'amazon', () => this.service.markShippedViaAmazon(item), 'Marked as shipped via Amazon');
  }

  // The one place a workflow action runs: gate, mark the order busy, do the
  // work, report, and ALWAYS clear - so the spinner can never stick and a
  // double-click cannot fire the same transition twice.
  private async run(
    item: CheckoutForm,
    action: WorkflowAction,
    work: () => Promise<unknown>,
    successMessage?: string
  ): Promise<void> {
    if (!this.canEdit() || this.isBusy(item)) {
      return;
    }
    this.busy.set(item.id!, action);
    try {
      await work();
      if (successMessage) {
        this.snackbar.success(successMessage);
      }
    } catch (err) {
      this.reportTransitionError(err);
    } finally {
      this.busy.delete(item.id!);
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

  sendAmazonConfirmation(item: CheckoutForm): void {
    if (!this.canEdit()) {
      return;
    }
    // The dialog sends + closes the order; the live streamAll() drops the
    // card automatically once fulfillmentStatus flips to 'closed'.
    this.dialog.open(AmazonConfirmationDialogComponent, { width: '520px', data: { item } });
  }

  private newRank(item: CheckoutForm): number {
    return this.isNew(item) ? 0 : 1;
  }

  // Every transition method above used to let a rejected write vanish
  // silently - no snackbar, no console-visible app error, button just
  // re-enabled with nothing else changed, indistinguishable from the click
  // never having registered at all. This is the one place that turns any
  // such failure (network blip, a transient Firestore write error, etc.)
  // into something the admin can actually see.
  private reportTransitionError(err: unknown): void {
    console.error('Fulfillment status update failed', err);
    this.snackbar.error("Couldn't update this order - please try again.");
  }
}
