import { Component, Input } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { CartItem, CheckoutForm } from 'impactdisciplescommon/src/models/utils/cart.model';
import { PurchasesService } from 'impactdisciplescommon/src/services/data/purchases.service';
import { AdminAuthService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';
import { dateFromTimestamp } from 'impactdisciplescommon/src/utils/date-from-timestamp';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';

// Embedded (not a dialog) inside PurchaseDialogComponent's "Sale Details"
// tab. The per-line-item refund action (refundLineItem) is fully commented
// out in both the template and the TS of the original - not ported at all,
// nothing lost since it was unreachable there either.
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

  constructor(public service: PurchasesService, private authService: AdminAuthService, private confirmService: ConfirmService, private snackbar: SnackbarService) {
    this.authService.dao.loggedInUser$.subscribe((user) => {
      this.currentUserRole = user?.role;
    });
  }

  isVisible(roles: string[]): boolean {
    return roles.some((role) => role === this.currentUserRole);
  }

  // costRow()/calcRow() wrap a CartItem back into the {data: item} shape
  // PurchasesService's calculate* helpers expect - those helpers were
  // written for DevExtreme's row objects, not the raw model. Wrapping at
  // the call site (rather than changing the shared service) keeps this a
  // presentational-only change.
  costRow(item: CartItem) {
    return { data: item };
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
      item.dateProcessed = dateFromTimestamp(Timestamp.now() as Timestamp) as any;

      const isOrderComplete = (this.selectedItem.cartItems ?? []).every((cartItem) => cartItem.processedStatus === 'SHIPPED');
      if (isOrderComplete) {
        this.selectedItem.processedStatus = 'COMPLETE';
        this.selectedItem.dateProcessed = Timestamp.now();
      }

      this.service.update(this.selectedItem.id!, this.selectedItem).then(() => {
        this.snackbar.success(`${item.itemName} x (${item.orderQuantity}) marked as ${item.processedStatus}`);
      });
    });
  }
}
