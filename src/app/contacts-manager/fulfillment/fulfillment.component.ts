import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, map, tap } from 'rxjs';
import { CheckoutForm } from 'src/app/common/models/utils/cart.model';
import { WhereFilterOperandKeys } from 'src/app/common/dao/firebase.dao';
import { PurchasesService } from 'src/app/common/services/data/purchases.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { toMillis } from 'src/app/common/utils/date-from-timestamp';
import { MatDialog } from '@angular/material/dialog';
import { SnackbarService } from '../../shared/snackbar.service';
import { AmazonConfirmationDialogComponent } from '../../shared/amazon-confirmation-dialog/amazon-confirmation-dialog.component';
import { FulfillmentStep, completedStepCount, segmentState, stepsFor } from './fulfillment-steps';

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

  // Tracks which order currently has a shipping-label request in flight -
  // printShippingLabel() is the one action here that's a real async network
  // call (the others are plain Firestore updates), so it's the only one
  // that needs its own per-row disabled state.
  printingIds = new Set<string>();

  private readonly screenKey = 'contacts-manager.fulfillment';

  constructor(private service: PurchasesService, private permissionService: PermissionService, private snackbar: SnackbarService, private router: Router, private dialog: MatDialog) {}

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

  isNew(item: CheckoutForm): boolean {
    return item.fulfillmentStatus === 'new';
  }

  acknowledgeOrder(item: CheckoutForm): void {
    if (!this.canEdit()) {
      return;
    }
    this.service.acknowledgeOrder(item)
      .then(() => this.snackbar.success('Order acknowledged'))
      .catch((err) => this.reportTransitionError(err));
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
    return (item.cartItems ?? []).map((c) => c.itemName).filter(Boolean).join(', ') || '—';
  }

  customerName(item: CheckoutForm): string {
    return [item.firstName, item.lastName].filter(Boolean).join(' ') || item.email || 'Unknown';
  }

  async printShippingLabel(item: CheckoutForm): Promise<void> {
    if (!this.canEdit()) {
      return;
    }
    this.printingIds.add(item.id!);
    try {
      await this.service.getShippingLabel(item);
    } catch (err) {
      this.reportTransitionError(err);
    } finally {
      this.printingIds.delete(item.id!);
    }
  }

  markPickedUp(item: CheckoutForm): void {
    if (!this.canEdit()) {
      return;
    }
    this.service.markPickedUp(item)
      .then(() => this.snackbar.success('Marked as picked up / delivered - order closed'))
      .catch((err) => this.reportTransitionError(err));
  }

  markPackaged(item: CheckoutForm): void {
    if (!this.canEdit()) {
      return;
    }
    this.service.markPackaged(item)
      .then(() => this.snackbar.success('Marked as packaged'))
      .catch((err) => this.reportTransitionError(err));
  }

  markShipped(item: CheckoutForm): void {
    if (!this.canEdit()) {
      return;
    }
    this.service.markShipped(item)
      .then(() => this.snackbar.success('Marked as shipped - order closed'))
      .catch((err) => this.reportTransitionError(err));
  }

  // The Amazon branch (2026-08-19): Amazon does the shipping; the final
  // step is the customer confirmation email, which closes the order.
  markShippedViaAmazon(item: CheckoutForm): void {
    if (!this.canEdit()) {
      return;
    }
    this.service.markShippedViaAmazon(item)
      .then(() => this.snackbar.success('Marked as shipped via Amazon'))
      .catch((err) => this.reportTransitionError(err));
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
