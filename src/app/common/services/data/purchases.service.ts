import { Injectable } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { CheckoutForm } from 'src/app/common/models/utils/cart.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class PurchasesService extends BaseService<CheckoutForm>{
  constructor(public override dao: FirebaseDAO<CheckoutForm>) {
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
}
