import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { Timestamp } from 'firebase/firestore';
import { CheckoutForm } from 'impactdisciplescommon/src/models/utils/cart.model';
import { PurchasesService } from 'impactdisciplescommon/src/services/data/purchases.service';
import { AdminAuthService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';
import { dateFromTimestamp } from 'impactdisciplescommon/src/utils/date-from-timestamp';
import { confirm } from 'devextreme/ui/dialog';
import notify from 'devextreme/ui/notify';

@Component({
    selector: 'app-purchase-details',
    templateUrl: './purchase-details.component.html',
    styleUrls: ['./purchase-details.component.css'],
    standalone: false
})
export class PurchaseDetailsComponent implements OnInit, OnDestroy {

  @Input('selectedItem')selectedItem: CheckoutForm;

  private ngUnsubscribe = new Subject<void>();
  // Was read fresh via authService.getLoggedInUser().role on every
  // isVisible() call - see events.component.ts for the full explanation
  // (a stale/expired role cookie throwing on a valid Firebase session).
  private currentUserRole?: string;

  constructor(public service: PurchasesService, private authService: AdminAuthService) { }

  ngOnInit() {
    this.authService.dao.loggedInUser$.pipe(takeUntil(this.ngUnsubscribe)).subscribe((user) => {
      this.currentUserRole = user?.role;
    });
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  isVisible(roles: string[]): boolean {
    return roles.filter(role => role == this.currentUserRole).length > 0;
  }



  markAsShipped = (e) => {
    confirm('<i>Are you sure you want to mark item as Shipped?</i>', 'Confirm').then((dialogResult) => {
      if (dialogResult) {
        e.row.data.processedStatus="SHIPPED";
        e.row.data.dateProcessed = dateFromTimestamp(Timestamp.now() as Timestamp);

        let isOrderComplete = true;

        this.selectedItem.cartItems.forEach(item => {
          if(item.processedStatus != 'SHIPPED'){
            isOrderComplete = false;
          }
        })

        if(isOrderComplete){
          this.selectedItem.processedStatus = 'COMPLETE';
          this.selectedItem.dateProcessed = Timestamp.now();
        }

        this.service.update(this.selectedItem.id, this.selectedItem).then(item => {
          notify({
            message: e.row.data.itemName + ' x ( ' + e.row.data.orderQuantity + ' ) marked as ' + e.row.data.processedStatus,
            position: 'top',
            width: 600,
            type: 'success'
          });
        })
      }
    });
  }

  // refundLineItem = (cartItem) => {
  //   let amountToRefund = this.calculateItemTotalAmount(cartItem.row);

  //   confirm('<i>Are you sure you want to refund amount $'+amountToRefund.toFixed(2)+'?</i>', 'Confirm').then(async (dialogResult) => {
  //     if (dialogResult) {
  //       this.isLoadingVisible$.next(true);

  //       // let request = { 'paymentIntent': (this.selectedItem.paymentIntent as PaymentIntent).id, 'amount': Number(amountToRefund.toFixed(2)) * 100}

  //       // let response = await fetch(environment.stripeRefundURL, {
  //       //   method: "POST",
  //       //   headers: { "Content-Type": "application/json" },
  //       //   body: JSON.stringify(request)
  //       // })

  //       // let result = await response.json();

  //       // cartItem.row.data.refundId=result.id;
  //       cartItem.row.data.processedStatus="REFUNDED";
  //       cartItem.row.data.dateProcessed = dateFromTimestamp(Timestamp.now() as Timestamp);

  //       this.selectedItem.refundAmount = (this.selectedItem.refundAmount? Number(this.selectedItem.refundAmount.toFixed(2)) : Number(Number(0).toFixed(0))) + amountToRefund;

  //       if(this.selectedItem.total.toFixed(2) == this.selectedItem.refundAmount.toFixed(2)){
  //         this.selectedItem.processedStatus="REFUNDED";
  //       } else {
  //         this.selectedItem.processedStatus="PARTIAL_REFUND"
  //       }

  //       this.service.update(this.selectedItem.id, this.selectedItem).then((item) => {
  //         notify({
  //           message: cartItem.row.data.itemName + ' Refunded ($' + amountToRefund.toFixed(2) + ')',
  //           position: 'top',
  //           width: 600,
  //           type: 'success'
  //         });

  //         this.isLoadingVisible$.next(false);
  //       })
  //     }
  //   });
  // }

  isShippedButtonsVisible(e){
    return e.row.data.isEvent == false && e.row.data.processedStatus != 'SHIPPED' && e.row.data.processedStatus != 'REFUNDED';
  }

  isRefundedButtonsVisible(e){
    return e.row.data.processedStatus != 'SHIPPED' && e.row.data.processedStatus != 'REFUNDED' && e.row.data.price > 0;
  }

}
