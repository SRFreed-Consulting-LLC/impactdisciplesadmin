import { Component, Inject } from '@angular/core';
import { Router } from '@angular/router';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { CheckoutForm } from 'src/app/common/models/utils/cart.model';
import { PurchasesService } from 'src/app/common/services/data/purchases.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { FulfillmentStep, segmentState, stepsFor } from 'src/app/contacts-manager/fulfillment/fulfillment-steps';
import { AmazonConfirmationDialogComponent } from '../amazon-confirmation-dialog/amazon-confirmation-dialog.component';
import { SnackbarService } from '../snackbar.service';

export interface OrderWorkflowDialogData {
  item: CheckoutForm;
}

// Opened from Dashboard's Recent Orders cards (see dashboard.component.ts)
// so an order's fulfillment workflow can be worked start-to-finish without
// leaving Home - the exact same actions/transitions as the real Fulfillment
// screen (src/app/contacts-manager/fulfillment/), just scoped to one order
// and popped up. Declared in SharedModule (imported eagerly by AppModule),
// not ContactsManagerModule (lazy) - a lazy module's components aren't
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
  item: CheckoutForm;
  printing = false;

  constructor(
    private dialogRef: MatDialogRef<OrderWorkflowDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) data: OrderWorkflowDialogData,
    private service: PurchasesService,
    private permissionService: PermissionService,
    private router: Router,
    private snackbar: SnackbarService,
    private dialog: MatDialog
  ) {
    this.item = data.item;
  }

  // Path-aware (standard vs Amazon branch) - recomputed as the status
  // changes so choosing "Shipped via Amazon" re-renders the bar on its
  // 4-step path.
  get steps(): FulfillmentStep[] {
    return stepsFor(this.item.fulfillmentStatus, this.item.statusHistory);
  }

  // Same gate PurchasesComponent.showEditModal() applies - never render a
  // link that would land somewhere the click gets silently swallowed.
  canViewPurchase(): boolean {
    return !!this.item.id && this.permissionService.canEdit('contacts-manager.purchases');
  }

  viewPurchase(): void {
    this.dialogRef.close();
    this.router.navigate(['/contacts-manager'], {
      queryParams: { tab: 'purchases', purchaseId: this.item.id }
    });
  }

  segmentState(index: number): 'done' | 'current' | 'pending' {
    return segmentState(this.steps, this.item.fulfillmentStatus, index);
  }

  refundStateLabel(): 'REFUNDED' | 'PARTIALLY REFUNDED' | null {
    return this.service.getRefundStateLabel(this.item);
  }

  itemSummary(): string {
    return (this.item.cartItems ?? []).map((c) => c.itemName).filter(Boolean).join(', ') || '—';
  }

  customerName(): string {
    return [this.item.firstName, this.item.lastName].filter(Boolean).join(' ') || this.item.email || 'Unknown';
  }

  acknowledgeOrder(): void {
    this.service.acknowledgeOrder(this.item)
      .then(() => {
        this.item.fulfillmentStatus = 'received';
        this.snackbar.success('Order acknowledged');
      })
      .catch((err) => this.reportTransitionError(err));
  }

  async printShippingLabel(): Promise<void> {
    this.printing = true;
    try {
      // Mutates this.item in place on success (shippingLabel + advances
      // fulfillmentStatus 'received' -> 'shipping_label_printed') - see
      // PurchasesService.getShippingLabel()'s own comment.
      await this.service.getShippingLabel(this.item);
    } catch (err) {
      this.reportTransitionError(err);
    } finally {
      this.printing = false;
    }
  }

  // Terminal action (skips straight to closed) - close the dialog right
  // after so the Dashboard behind it can refresh and this order drops out
  // of the open-orders list, same as it would on the real Fulfillment
  // screen.
  markPickedUp(): void {
    this.service.markPickedUp(this.item)
      .then(() => {
        this.snackbar.success('Marked as picked up / delivered - order closed');
        this.dialogRef.close(true);
      })
      .catch((err) => this.reportTransitionError(err));
  }

  // The Amazon branch: Amazon does the shipping, so the only remaining
  // step is the customer confirmation email (which closes the order).
  markShippedViaAmazon(): void {
    this.service.markShippedViaAmazon(this.item)
      .then((saved) => {
        this.item.fulfillmentStatus = saved.fulfillmentStatus;
        this.item.statusHistory = saved.statusHistory;
        this.snackbar.success('Marked as shipped via Amazon');
      })
      .catch((err) => this.reportTransitionError(err));
  }

  sendAmazonConfirmation(): void {
    this.dialog.open<AmazonConfirmationDialogComponent, { item: CheckoutForm }, CheckoutForm | null>(
      AmazonConfirmationDialogComponent, { width: '520px', data: { item: this.item } }
    ).afterClosed().subscribe((saved) => {
      if (saved) {
        // Terminal - same close-the-dialog behavior as markShipped().
        this.dialogRef.close(true);
      }
    });
  }

  markPackaged(): void {
    this.service.markPackaged(this.item)
      .then(() => {
        this.item.fulfillmentStatus = 'awaiting_shipping';
        this.snackbar.success('Marked as packaged');
      })
      .catch((err) => this.reportTransitionError(err));
  }

  // Terminal action - see markPickedUp()'s own comment.
  markShipped(): void {
    this.service.markShipped(this.item)
      .then(() => {
        this.snackbar.success('Marked as shipped - order closed');
        this.dialogRef.close(true);
      })
      .catch((err) => this.reportTransitionError(err));
  }

  onClose(): void {
    this.dialogRef.close();
  }

  // Same rationale as FulfillmentComponent's own reportTransitionError() -
  // this dialog shares PurchasesService with that screen and had the same
  // gap: a rejected write used to vanish with no snackbar, no visible app
  // error, nothing - the dialog just sat there looking like the click never
  // registered.
  private reportTransitionError(err: unknown): void {
    console.error('Fulfillment status update failed', err);
    this.snackbar.error("Couldn't update this order - please try again.");
  }
}
