import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { PaymentIntent } from '@stripe/stripe-js';
import { CheckoutForm } from 'impactdisciplescommon/src/models/utils/cart.model';
import { PurchasesService } from 'impactdisciplescommon/src/services/data/purchases.service';
import { AdminAuthService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';
import { EnumHelper } from 'impactdisciplescommon/src/utils/enum_helper';
import { environment } from 'src/environments/environment';
import { SnackbarService } from '../../shared/snackbar.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';

export interface PurchaseDialogData {
  item: CheckoutForm;
}

// Edit-only, matching the original - purchases are created by the
// storefront checkout, never by an admin here. showAddModal() from the
// original was dead code (seeded selectedItem from a ProductModel spread,
// didn't match CheckoutForm's shape, and no button ever called it) - not
// ported at all.
@Component({
    selector: 'app-purchase-dialog',
    templateUrl: './purchase-dialog.component.html',
    styleUrls: ['./purchase-dialog.component.scss'],
    standalone: false
})
export class PurchaseDialogComponent {
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isRefunding$ = new BehaviorSubject<boolean>(false);

  states = EnumHelper.getStateTypesAsArray();
  phoneTypes = EnumHelper.getPhoneTypesAsArray();
  statuses = ['NEW', 'COMPLETE', 'REFUNDED'];

  // Was read fresh via authService.getLoggedInUser().role on every
  // isVisible() call - see events.component.ts for the full explanation.
  currentUserRole?: string;

  constructor(
    private dialogRef: MatDialogRef<PurchaseDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: PurchaseDialogData,
    private fb: FormBuilder,
    private service: PurchasesService,
    private authService: AdminAuthService,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {
    this.authService.dao.loggedInUser$.subscribe((user) => {
      this.currentUserRole = user?.role;
    });

    this.form = this.fb.group({
      processedStatus: [data.item.processedStatus ?? 'NEW'],
      phone: this.fb.group({
        countryCode: [data.item.phone?.countryCode ?? ''],
        number: [data.item.phone?.number ?? ''],
        type: [data.item.phone?.type ?? null]
      }),
      shippingAddress: this.fb.group({
        address1: [data.item.shippingAddress?.address1 ?? ''],
        address2: [data.item.shippingAddress?.address2 ?? ''],
        city: [data.item.shippingAddress?.city ?? ''],
        state: [data.item.shippingAddress?.state ?? ''],
        zip: [data.item.shippingAddress?.zip ?? ''],
        country: [data.item.shippingAddress?.country ?? '']
      })
    });
  }

  isVisible(roles: string[]): boolean {
    return roles.some((role) => role === this.currentUserRole);
  }

  getOrderStatusDisplay(): string {
    return this.data.item.payPalReceipt ? (this.data.item.payPalReceipt as any)?.status : (this.data.item.paymentIntent as PaymentIntent)?.status;
  }

  getOrderItemCount(): number {
    return (this.data.item.cartItems ?? []).map((item) => item.orderQuantity ?? 0).reduce((a, b) => a + b, 0);
  }

  getProductTotalDisplayAmount(): number {
    const item = this.data.item;
    return item.payPalReceipt ? parseFloat((item.payPalReceipt as any)?.purchase_units[0]?.amount?.breakdown.item_total.value) : (item.total ?? 0) > 0 ? item.total! : 0;
  }

  getTaxesDisplayAmount(): number {
    const item = this.data.item;
    return item.payPalReceipt ? parseFloat((item.payPalReceipt as any).purchase_units[0].amount.breakdown.tax_total.value) : (item.estimatedTaxes ?? 0) > 0 ? item.estimatedTaxes! : 0;
  }

  getShippingDisplayAmount(): number {
    const item = this.data.item;
    return item.payPalReceipt ? parseFloat((item.payPalReceipt as any).purchase_units[0].amount.breakdown.shipping.value) : item.shippingRate ? item.shippingRate : 0;
  }

  getShippingDiscountDisplayAmount(): number {
    const item = this.data.item;
    return item.payPalReceipt ? parseFloat((item.payPalReceipt as any).purchase_units[0].amount.breakdown.shipping_discount.value) : (item.shippingDiscount ?? 0) > 0 ? item.shippingDiscount! : 0;
  }

  getDiscountDisplayAmount(): number {
    const item = this.data.item;
    return item.payPalReceipt && (item.payPalReceipt as any)?.purchase_units[0]?.amount?.breakdown?.discount
      ? parseFloat((item.payPalReceipt as any).purchase_units[0].amount.breakdown.discount.value)
      : (item.discount ?? 0) > 0
        ? item.discount!
        : 0;
  }

  getChargedDisplayAmount(): number {
    const item = this.data.item;
    return item.payPalReceipt ? parseFloat((item.payPalReceipt as any)?.purchase_units[0]?.amount?.value) : (item.total ?? 0) - (item.discount ?? 0) > 0 ? item.total! : 0;
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onSave(): void {
    this.inProgress$.next(true);
    const value: CheckoutForm = { ...this.data.item, ...this.form.value };

    this.service.update(value.id!, value).then((result) => {
      if (result) {
        this.snackbar.success('Purchase Updated');
        this.dialogRef.close(true);
      } else {
        this.inProgress$.next(false);
        this.snackbar.error('Some Error Occured');
      }
    });
  }

  // Refunds move real money - this endpoint requires a verified staff
  // Firebase ID token. The button that called this is commented out in the
  // original UI (method still exists, just unreachable) - preserved
  // exactly as-is here too: ported, but left unwired to any button, rather
  // than either removing it or re-enabling it. Never triggered during my
  // own live verification for that reason.
  refundOrder(): void {
    const amountToRefund = this.data.item.total ?? 0;

    this.confirmService.confirm(`<i>Are you sure you want to refund amount $${amountToRefund.toFixed(2)}?</i>`, 'Confirm').then(async (confirmed) => {
      if (!confirmed) {
        return;
      }

      this.isRefunding$.next(true);

      const request = { paymentIntent: (this.data.item.paymentIntent as PaymentIntent).id };
      const idToken = await this.authService.dao.auth.currentUser?.getIdToken();

      const response = await fetch(environment.stripeRefundURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
        body: JSON.stringify(request)
      });

      const result = await response.json();

      this.data.item.refundAmount = Number(amountToRefund.toFixed(2));
      this.data.item.refundId = result.id;
      this.data.item.processedStatus = 'REFUNDED';

      this.service.update(this.data.item.id!, this.data.item).then(() => {
        this.snackbar.success(`Order Refunded ($${amountToRefund.toFixed(2)})`);
        this.isRefunding$.next(false);
      });
    });
  }
}
