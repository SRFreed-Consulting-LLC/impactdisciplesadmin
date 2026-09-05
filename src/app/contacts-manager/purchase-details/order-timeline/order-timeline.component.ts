import { Component, Input } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { CheckoutForm, FulfillmentStatus, PurchaseRefundEntry } from '@impact-common/shared/models/utils/cart.model';
import { PurchasesService } from 'src/app/common/services/data/purchases.service';
import { AMAZON_FULFILLMENT_STEPS, FULFILLMENT_STEPS, FulfillmentStep, stepsFor } from 'src/app/shared/fulfillment/fulfillment-steps';

export interface TimelineNode {
  step: FulfillmentStep;
  state: 'done' | 'current' | 'pending';
  date?: Date | Timestamp;
  by?: string;
}

// The order timeline + refund history on the sale detail screen - extracted
// from PurchaseDetailsComponent 2026-08-21 (bucket A item #5), which was 468
// lines of TS + 297 of template across seven concerns.
//
// Read-only: it derives both lists from the purchase it is given and renders
// them. It never mutates the order, so it needs no outputs; the workflow
// actions that DO move an order stay with the host, and this recomputes on
// the next change-detection pass because both are plain getters over the
// same object the host mutates in place.
//
// PurchasesService is injected only for getChargedDisplayAmount(), which the
// legacy-refund fallback below needs to show an amount for orders that
// predate the refunds[] array.
@Component({
    selector: 'app-order-timeline',
    templateUrl: './order-timeline.component.html',
    styleUrls: ['./order-timeline.component.scss'],
    standalone: false
})
export class OrderTimelineComponent {
  @Input() item!: CheckoutForm;

  constructor(private service: PurchasesService) {}

  // Real recorded events (item.statusHistory) render as "done"/"current"
  // with their actual date + who did it; steps still ahead of the current
  // status render as "pending" with no date, never a fabricated one. Orders
  // that predate statusHistory (see StatusHistoryEntry's own comment,
  // cart.model.ts) have none recorded - falls back to a single node built
  // from dateProcessed + the current status, rather than inventing a history
  // that was never captured.
  get timeline(): TimelineNode[] {
    const recorded = this.item.statusHistory?.length
      ? this.item.statusHistory
      : [{ status: (this.item.fulfillmentStatus ?? 'new') as FulfillmentStatus, date: this.item.dateProcessed as Timestamp }];

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

    // Path-aware (standard vs Amazon branch) so an Amazon order's timeline
    // shows "Send Confirmation Email" ahead, not label/packaging steps.
    const path = stepsFor(this.item.fulfillmentStatus, this.item.statusHistory);
    const currentIndex = path.findIndex((s) => s.status === this.item.fulfillmentStatus);
    const upcoming: TimelineNode[] = currentIndex >= 0
      ? path.slice(currentIndex + 1).map((step) => ({ step, state: 'pending' as const }))
      : [];

    return [...doneNodes, ...upcoming];
  }

  private stepFor(status: FulfillmentStatus): FulfillmentStep {
    // The order's OWN path first, so an Amazon order's 'closed' node reads
    // "Confirmation Email Sent" rather than the standard path's "Product
    // Shipped" (both paths share the 'closed' status).
    const path = stepsFor(this.item.fulfillmentStatus, this.item.statusHistory);
    return path.find((s) => s.status === status) ??
      [...FULFILLMENT_STEPS, ...AMAZON_FULFILLMENT_STEPS].find((s) => s.status === status) ??
      { status, label: status, statusLabel: status };
  }

  // The refunds history the timeline card renders - legacy fully-refunded
  // purchases (pre-refunds[]) get one synthesized row from refundedAt/
  // refundedBy so their history isn't blank.
  refundHistory(): PurchaseRefundEntry[] {
    const refunds = this.item.refunds ?? [];
    if (refunds.length === 0 && this.item.refunded) {
      return [{
        amount: this.item.refundAmount || this.service.getChargedDisplayAmount(this.item),
        date: this.item.refundedAt as Timestamp,
        ...(this.item.refundedBy ? { by: this.item.refundedBy } : {}),
        ...(this.item.refundId ? { refundId: this.item.refundId } : {})
      }];
    }
    return refunds;
  }
}
