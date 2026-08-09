import { Injectable } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { CheckoutForm } from 'src/app/common/models/utils/cart.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { environment } from 'src/environments/environment';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { SnackbarService } from 'src/app/shared/snackbar.service';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class PurchasesService extends BaseService<CheckoutForm>{
  constructor(
    public override dao: FirebaseDAO<CheckoutForm>,
    private authService: AdminAuthService,
    private snackbar: SnackbarService
  ) {
    super(dao)
    this.table="purchases"
    this.fromFirestore = PurchasesService.fromFirestore
  }

  static readonly fromFirestore = (data): CheckoutForm => {
    data.dateProcessed = dateFromTimestamp(data.dateProcessed as Timestamp)

    return data;
  };



  calculateProductCostAmount(cartItem){
      return cartItem.data.salePrice ? cartItem.data.salePrice : cartItem.data.price;
  }
  calculateItemTotalAmount(cartItem, selectedItem){
    const totalPrice = cartItem.data.salePrice ? cartItem.data.salePrice : cartItem.data.price;
    const quantity = cartItem.data.orderQuantity;
    const discount = cartItem.data.discount ? cartItem.data.discount : 0;
    const shippingAmount = cartItem.data.isEvent? 0 : this.calculateItemShippingAmount(cartItem, selectedItem);
    const taxAmount = this.calculateItemTaxableAmount(cartItem, selectedItem);

    const amountToRefund: number  = ((totalPrice - discount) * quantity) + (shippingAmount? shippingAmount : 0) + (taxAmount ? taxAmount : 0);

    return amountToRefund;
  }

  calculateItemTaxableAmount(cartItem, selectedItem){
    return (!cartItem.data.isEvent? (cartItem.data.price * cartItem.data.orderQuantity) * selectedItem.taxRate : 0);
  }

  calculateItemShippingAmount(cartItem, selectedItem){
    if(!cartItem.data.isEvent){
      let totalWeight: number;
      try{
        totalWeight = selectedItem.cartItems.filter(item => item.isEvent == false).map(item => item.weight? item.weight : 0).reduce((a,b) => a + b);
      } catch (err){
        console.error(err)
        totalWeight = 0;
      }
      return (selectedItem.shippingRate - selectedItem.shippingDiscount) * parseFloat((cartItem.data.weight / totalWeight).toFixed(2));
    } else {
      return 0;
    }
  }

  calculateItemDiscountAmount(cartItem){
    const discountAmount = (cartItem.data.price - cartItem.data.discountPrice) * cartItem.data.orderQuantity

    return discountAmount && discountAmount > 0 ? discountAmount : 0;
  }

  calculateOrderRefundedAmount(selectedItem){
    const refundedItems = selectedItem.cartItems.filter(item => item.processedStatus == "REFUNDED");
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
  async getShippingLabel(item: CheckoutForm): Promise<void> {
    if (!item.shippingLabel) {
      const idToken = await this.authService.dao.auth.currentUser?.getIdToken();

      const request = await fetch(environment.shippingLabelUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
        body: JSON.stringify({ shipId: item.shippingRateId.rateId })
      });

      const response = await request.json();

      if (response.code === 400) {
        this.snackbar.error(response.error.message);
        item.shippingLabel = response;
      } else {
        item.shippingLabel = response;
        if (item.fulfillmentStatus === 'received') {
          item.fulfillmentStatus = 'shipping_label_printed';
        }
        this.update(item.id!, item).then((saved) => {
          this.downloadShippingLabel(saved!.shippingLabel.labelDownload.pdf);
        });
      }
    } else if (item.shippingLabel?.code) {
      this.snackbar.error(item.shippingLabel.error.message);
    } else {
      this.downloadShippingLabel(item.shippingLabel.labelDownload.pdf);
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
    return this.update(item.id!, { ...item, fulfillmentStatus: 'received' });
  }

  // Override for orders picked up in person or hand-delivered - they never
  // get a shipping label or a separate packaging step, so this jumps
  // straight from 'received' to 'closed', skipping shipping_label_printed
  // and awaiting_shipping entirely.
  markPickedUp(item: CheckoutForm): Promise<CheckoutForm> {
    return this.update(item.id!, { ...item, fulfillmentStatus: 'closed' });
  }

  markPackaged(item: CheckoutForm): Promise<CheckoutForm> {
    return this.update(item.id!, { ...item, fulfillmentStatus: 'awaiting_shipping' });
  }

  markShipped(item: CheckoutForm): Promise<CheckoutForm> {
    return this.update(item.id!, { ...item, fulfillmentStatus: 'closed' });
  }
}
