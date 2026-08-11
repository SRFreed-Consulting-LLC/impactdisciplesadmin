import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { CheckoutForm } from 'src/app/common/models/utils/cart.model';
import { PurchasesService } from 'src/app/common/services/data/purchases.service';
import { FULFILLMENT_STEPS, segmentState } from 'src/app/customers-manager/fulfillment/fulfillment-steps';
import { SnackbarService } from '../snackbar.service';

export interface OrderWorkflowDialogData {
  item: CheckoutForm;
}

// Opened from Dashboard's Recent Orders cards (see dashboard.component.ts)
// so an order's fulfillment workflow can be worked start-to-finish without
// leaving Home - the exact same actions/transitions as the real Fulfillment
// screen (src/app/customers-manager/fulfillment/), just scoped to one order
// and popped up. Declared in SharedModule (imported eagerly by AppModule),
// not CustomersManagerModule (lazy) - a lazy module's components aren't
// resolvable by MatDialog.open() until that module has actually been
// loaded, which isn't guaranteed the first time someone lands on Home.
//
// Unlike FulfillmentComponent's own list (a live streamAll()), the
// Dashboard's order list is a one-time getAll() - so, unlike that screen,
// the transition methods here don't get a fresh object back from a live
// listener automatically. Each handler below updates `item` locally right
// after its own service call succeeds, rather than relying on mutation-
// by-reference (PurchasesService.getShippingLabel() happens to mutate its
// argument in place; the plain status-transition methods do not - update()
// spreads a NEW object and returns it, it doesn't touch the one passed in).
@Component({
    selector: 'app-order-workflow-dialog',
    templateUrl: './order-workflow-dialog.component.html',
    styleUrls: ['./order-workflow-dialog.component.scss'],
    standalone: false
})
export class OrderWorkflowDialogComponent {
  steps = FULFILLMENT_STEPS;
  item: CheckoutForm;
  printing = false;

  constructor(
    private dialogRef: MatDialogRef<OrderWorkflowDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) data: OrderWorkflowDialogData,
    private service: PurchasesService,
    private snackbar: SnackbarService
  ) {
    this.item = data.item;
  }

  segmentState(index: number): 'done' | 'current' | 'pending' {
    return segmentState(this.item.fulfillmentStatus, index);
  }

  itemSummary(): string {
    return (this.item.cartItems ?? []).map((c) => c.itemName).filter(Boolean).join(', ') || '—';
  }

  customerName(): string {
    return [this.item.firstName, this.item.lastName].filter(Boolean).join(' ') || this.item.email || 'Unknown';
  }

  acknowledgeOrder(): void {
    this.service.acknowledgeOrder(this.item).then(() => {
      this.item.fulfillmentStatus = 'received';
      this.snackbar.success('Order acknowledged');
    });
  }

  async printShippingLabel(): Promise<void> {
    this.printing = true;
    try {
      // Mutates this.item in place on success (shippingLabel + advances
      // fulfillmentStatus 'received' -> 'shipping_label_printed') - see
      // PurchasesService.getShippingLabel()'s own comment.
      await this.service.getShippingLabel(this.item);
    } finally {
      this.printing = false;
    }
  }

  // Terminal action (skips straight to closed) - close the dialog right
  // after so the Dashboard behind it can refresh and this order drops out
  // of the open-orders list, same as it would on the real Fulfillment
  // screen.
  markPickedUp(): void {
    this.service.markPickedUp(this.item).then(() => {
      this.snackbar.success('Marked as picked up / delivered - order closed');
      this.dialogRef.close(true);
    });
  }

  markPackaged(): void {
    this.service.markPackaged(this.item).then(() => {
      this.item.fulfillmentStatus = 'awaiting_shipping';
      this.snackbar.success('Marked as packaged');
    });
  }

  // Terminal action - see markPickedUp()'s own comment.
  markShipped(): void {
    this.service.markShipped(this.item).then(() => {
      this.snackbar.success('Marked as shipped - order closed');
      this.dialogRef.close(true);
    });
  }

  onClose(): void {
    this.dialogRef.close();
  }
}
