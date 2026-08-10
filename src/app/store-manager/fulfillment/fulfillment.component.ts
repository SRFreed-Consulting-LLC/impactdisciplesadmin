import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, map, tap } from 'rxjs';
import { CheckoutForm } from 'src/app/common/models/utils/cart.model';
import { PurchasesService } from 'src/app/common/services/data/purchases.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { FULFILLMENT_STEPS, completedStepCount, segmentState } from './fulfillment-steps';

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
  steps = FULFILLMENT_STEPS;

  orders$: Observable<CheckoutForm[]>;

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
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

  constructor(private service: PurchasesService, private snackbar: SnackbarService) {}

  ngOnInit(): void {
    this.loadOrders();
  }

  // Re-invokable (not just ngOnInit's one-shot setup) so retry() can
  // establish a brand new streamAll() subscription after a failure - see
  // loadFailed$'s own comment on why the old one can't just be waited out.
  loadOrders(): void {
    this.loading$.next(true);
    this.loadFailed$.next(false);

    this.orders$ = this.service.streamAll(undefined, () => this.loadFailed$.next(true)).pipe(
      map((items) => items
        .filter((item) => item.fulfillmentStatus && item.fulfillmentStatus !== 'closed')
        // 'new' orders always float to the top (the whole point of the
        // status - see fulfillment-steps.ts), then oldest-first within
        // each group so nothing already in progress gets buried by a
        // newer arrival.
        .sort((a, b) => this.newRank(a) - this.newRank(b) || this.toMillis(a.dateProcessed) - this.toMillis(b.dateProcessed))
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
    this.service.acknowledgeOrder(item).then(() => this.snackbar.success('Order acknowledged'));
  }

  completedCount(item: CheckoutForm): number {
    return completedStepCount(item.fulfillmentStatus);
  }

  // Delegates to the shared free function (fulfillment-steps.ts) so this
  // and DashboardComponent's read-only Recent Orders preview render
  // identical bars off one definition - see that function's own comment.
  segmentState(item: CheckoutForm, index: number): 'done' | 'current' | 'pending' {
    return segmentState(item.fulfillmentStatus, index);
  }

  itemSummary(item: CheckoutForm): string {
    return (item.cartItems ?? []).map((c) => c.itemName).filter(Boolean).join(', ') || '—';
  }

  customerName(item: CheckoutForm): string {
    return [item.firstName, item.lastName].filter(Boolean).join(' ') || item.email || 'Unknown';
  }

  async printShippingLabel(item: CheckoutForm): Promise<void> {
    this.printingIds.add(item.id!);
    try {
      await this.service.getShippingLabel(item);
    } finally {
      this.printingIds.delete(item.id!);
    }
  }

  markPickedUp(item: CheckoutForm): void {
    this.service.markPickedUp(item).then(() => this.snackbar.success('Marked as picked up / delivered - order closed'));
  }

  markPackaged(item: CheckoutForm): void {
    this.service.markPackaged(item).then(() => this.snackbar.success('Marked as packaged'));
  }

  markShipped(item: CheckoutForm): void {
    this.service.markShipped(item).then(() => this.snackbar.success('Marked as shipped - order closed'));
  }

  private toMillis(date: unknown): number {
    return date instanceof Date ? date.getTime() : 0;
  }

  private newRank(item: CheckoutForm): number {
    return this.isNew(item) ? 0 : 1;
  }
}
