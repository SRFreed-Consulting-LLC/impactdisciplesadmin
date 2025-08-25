import { Component, OnInit, ViewChild } from '@angular/core';
import { DxDataGridComponent, DxFormComponent } from 'devextreme-angular';
import CustomStore from 'devextreme/data/custom_store';
import DataSource from 'devextreme/data/data_source';
import notify from 'devextreme/ui/notify';
import { confirm } from 'devextreme/ui/dialog';
import { CheckoutForm } from 'impactdisciplescommon/src/models/utils/cart.model';
import { ProductModel } from 'impactdisciplescommon/src/models/utils/product.model';
import { PurchasesService } from 'impactdisciplescommon/src/services/data/purchases.service';
import { Observable, BehaviorSubject, map } from 'rxjs';
import { EnumHelper } from 'impactdisciplescommon/src/utils/enum_helper';
import { Timestamp } from 'firebase/firestore';
import { dateFromTimestamp } from 'impactdisciplescommon/src/utils/date-from-timestamp';
import { environment } from 'src/environments/environment';
import { PaymentIntent } from '@stripe/stripe-js';
import { AuthService } from 'impactdisciplescommon/src/services/utils/auth.service';
import { Workbook } from 'exceljs';
import { exportDataGrid as exportXLSDataGrid} from 'devextreme/excel_exporter';
import { saveAs } from 'file-saver';

@Component({
  selector: 'app-purchases',
  templateUrl: './purchases.component.html',
  styleUrls: ['./purchases.component.css']
})
export class PurchasesComponent implements OnInit {
  @ViewChild('addEditForm', { static: false }) addEditForm: DxFormComponent;
  @ViewChild('purchasesGrid', { static: false }) purchasesGrid: DxDataGridComponent;

  datasource$: Observable<DataSource>;
  selectedItem: CheckoutForm;

  itemType = 'Purchase';

  public inProgress$ = new BehaviorSubject<boolean>(false)
  public isVisible$ = new BehaviorSubject<boolean>(false);
  public isLoadingVisible$ = new BehaviorSubject<boolean>(false);
  public isSingleImageVisible$ = new BehaviorSubject<boolean>(false);

  productTags: any[] = [];

  series: any[] = [];

  phoneEditorOptions = {
    mask: '(X00) 000-0000',
    maskRules: {
      X: /[02-9]/,
    },
    maskInvalidMessage: 'The phone must have a correct USA phone format',
    valueChangeEvent: 'keyup',
  };

  public states: string[];

  phone_types;

  constructor(private service: PurchasesService, private authService: AuthService) {}

  ngOnInit() {
    this.datasource$ = this.service.streamAll().pipe(
      map(
        (items) =>
          new DataSource({
            reshapeOnPush: true,
            pushAggregationTimeout: 100,
            store: new CustomStore({
              key: 'id',
              loadMode: 'raw',
              load: function (loadOptions: any) {
                return items;
              }
            })
          })
      )
    );

    this.phone_types = EnumHelper.getPhoneTypesAsArray();
    this.states = EnumHelper.getStateTypesAsArray();
  }

  showEditModal = (e) => {
    this.selectedItem = (Object.assign({}, e.data));

    this.isVisible$.next(true);
  }

  showAddModal = () => {
    this.selectedItem = {... new ProductModel()};

    this.isVisible$.next(true);
  }

  delete = ({ row: { data } }) => {
    confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((dialogResult) => {
      if (dialogResult) {
        this.service.delete(data.id).then(() => {
          notify({
            message: this.itemType + ' Deleted',
            position: 'top',
            width: 600,
            type: 'success'
          });
        })
      }
    });
  }

  onSave(item: CheckoutForm) {
    if(this.addEditForm.instance.validate().isValid) {
      this.inProgress$.next(true);

      if(item.id) {
        this.service.update(item.id, item).then((item) => {
          if(item) {
            notify({
              message: this.itemType + ' Updated',
              position: 'top',
              width: 600,
              type: 'success'
            });
            this.onCancel();
          } else {
            this.inProgress$.next(false);
            notify({
              message: 'Some Error Occured',
              position: 'top',
              width: 600,
              type: 'success'
            });
          }
        })
      } else {
        this.service.add(item).then((item) => {
          if(item) {
            notify({
              message: this.itemType + ' Added',
              position: 'top',
              width: 600,
              type: 'success'
            });
            this.onCancel();
          } else {
            this.inProgress$.next(false);
            notify({
              message: 'Some Error Occured',
              position: 'top',
              width: 600,
              type: 'error'
            });
          }
        })
      }
    }
  }

  getShippingLabel = async (e) =>{
    if(!e.row.data?.shippingLabel){
      let data = { 'shipId': e.row.data.shippingRateId.rateId};

      let request = await fetch(environment.shippingLabelUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      })

      let response = await request.json();

      if(response.code == 400){
        console.log(response);

        notify({
          message: response.error.message,
          position: 'top',
          width: 600,
          type: 'error'
        });

        e.row.data.shippingLabel = response;
      } else {
        e.row.data.shippingLabel = response;

        await this.service.update(e.row.data.id, e.row.data).then(sale => {
          this.downloadShippingLabel(sale.shippingLabel.labelDownload.pdf)
        })
      }
    } else {
      if(e.row.data.shippingLabel?.code){
        notify({
          message: e.row.data.shippingLabel.error.message,
          position: 'top',
          width: 600,
          type: 'error'
        });
      } else {
        this.downloadShippingLabel(e.row.data.shippingLabel.labelDownload.pdf)
      }
    }
  }

  downloadShippingLabel(pdf){
    const link = document.createElement('a');
    link.setAttribute('target', '_blank');
    link.setAttribute('href', pdf);
    link.setAttribute('download', `products.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  isShippingButtonVisible(e){
    return e.row.data?.shippingRate > 0;
  }

  onCancel() {
    this.selectedItem = null;
    this.inProgress$.next(false);
    this.isVisible$.next(false);
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

  isShippedButtonsVisible(e){
    return e.row.data.isEvent == false && e.row.data.processedStatus != 'SHIPPED' && e.row.data.processedStatus != 'REFUNDED';
  }

  isRefundedButtonsVisible(e){
    return e.row.data.processedStatus != 'SHIPPED' && e.row.data.processedStatus != 'REFUNDED' && e.row.data.price > 0;
  }

  getItemTaxableAmount(cartItem){
    return (!cartItem.data.isEvent? (cartItem.data.price * cartItem.data.orderQuantity) * this.selectedItem.taxRate : 0);
  }

  getItemShippingAmount(cartItem){
    if(!cartItem.data.isEvent){
      let totalWeight: number;
      try{
        totalWeight = this.selectedItem.cartItems.filter(item => item.isEvent == false).map(item => item.weight).reduce((a,b) => a + b);
      } catch (err){
        totalWeight = 0;
      }
      return this.selectedItem.shippingRate * parseFloat((cartItem.data.weight / totalWeight).toFixed(2));
    } else {
      return 0;
    }
  }

  getItemTotalAmount(cartItem){
    let totalPrice = cartItem.data.salePrice ? cartItem.data.salePrice : cartItem.data.price;
    let quantity = cartItem.data.orderQuantity;
    let discount = cartItem.data.discount ? cartItem.data.discount : 0;
    let shippingAmount = cartItem.data.isEvent? 0 : this.getItemShippingAmount(cartItem);
    let taxAmount = this.getItemTaxableAmount(cartItem);

    let amountToRefund: number  = ((totalPrice - discount) * quantity) + (shippingAmount? shippingAmount : 0) + (taxAmount ? taxAmount : 0);

    return amountToRefund;
  }

  getItemDiscountAmount(cartItem){
    return (cartItem.data.price - cartItem.data.discountPrice) * cartItem.data.orderQuantity
  }

  getDiscountAmount(){
    return Number((this.selectedItem.discount));
  }

  getChargedAmount(){
    if(this.selectedItem?.paymentIntent && this.selectedItem.paymentIntent['amount']){
      return Number((this.selectedItem.paymentIntent as PaymentIntent).amount) * .01;
    } else {
      return 0;
    }
  }

  getOrderRefundedAmount(){
    let refundedItems = this.selectedItem.cartItems.filter(item => item.processedStatus == "REFUNDED");
    let totalRefundedList: number[] = refundedItems.map(item => this.getItemTotalAmount({data: item}));

    if(totalRefundedList && totalRefundedList.length > 0){
      return Number(totalRefundedList.reduce((a,b) => a + b).toFixed(2));
    } else {
      return  Number(Number(0).toFixed(0));

    }
  }

  refundLineItem = (cartItem) => {
    let amountToRefund = this.getItemTotalAmount(cartItem.row);

    confirm('<i>Are you sure you want to refund amount $'+amountToRefund.toFixed(2)+'?</i>', 'Confirm').then(async (dialogResult) => {
      if (dialogResult) {
        this.isLoadingVisible$.next(true);

        // let request = { 'paymentIntent': (this.selectedItem.paymentIntent as PaymentIntent).id, 'amount': Number(amountToRefund.toFixed(2)) * 100}

        // let response = await fetch(environment.stripeRefundURL, {
        //   method: "POST",
        //   headers: { "Content-Type": "application/json" },
        //   body: JSON.stringify(request)
        // })

        // let result = await response.json();

        // cartItem.row.data.refundId=result.id;
        cartItem.row.data.processedStatus="REFUNDED";
        cartItem.row.data.dateProcessed = dateFromTimestamp(Timestamp.now() as Timestamp);

        this.selectedItem.refundAmount = (this.selectedItem.refundAmount? Number(this.selectedItem.refundAmount.toFixed(2)) : Number(Number(0).toFixed(0))) + amountToRefund;

        if(this.selectedItem.total.toFixed(2) == this.selectedItem.refundAmount.toFixed(2)){
          this.selectedItem.processedStatus="REFUNDED";
        } else {
          this.selectedItem.processedStatus="PARTIAL_REFUND"
        }

        this.service.update(this.selectedItem.id, this.selectedItem).then((item) => {
          notify({
            message: cartItem.row.data.itemName + ' Refunded ($' + amountToRefund.toFixed(2) + ')',
            position: 'top',
            width: 600,
            type: 'success'
          });

          this.isLoadingVisible$.next(false);
        })
      }
    });
  }

  refundOrder = () => {
    let amountToRefund = this.selectedItem.total;

    confirm('<i>Are you sure you want to refund amount $'+amountToRefund.toFixed(2)+'?</i>', 'Confirm').then(async (dialogResult) => {
      if (dialogResult) {
        this.isLoadingVisible$.next(true);

        let request = { 'paymentIntent': (this.selectedItem.paymentIntent as PaymentIntent).id}

        let response = await fetch(environment.stripeRefundURL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request)
        })

        let result = await response.json();

        this.selectedItem.refundAmount = Number(amountToRefund.toFixed(2))
        this.selectedItem.refundId=result.id;

        this.selectedItem.processedStatus="REFUNDED";

        this.service.update(this.selectedItem.id, this.selectedItem).then((item) => {
          notify({
            message: 'Order  Refunded ($' + amountToRefund.toFixed(2) + ')',
            position: 'top',
            width: 600,
            type: 'success'
          });

          this.isLoadingVisible$.next(false);
        })
      }
    });
  }

  onRowPrepared(e) {
    if (e.rowType === "data") {
      let total = e.data.totalBeforeDiscount;

      if(e.data.discount){
        total -= e.data.discount;
      }

      if(e.data.estimatedTaxes){
        total += e.data.estimatedTaxes;
      }

      if(e.data.shippingRate){
        total += e.data.shippingRate;
      }

      if(e.data.shippingDiscount){
        total -= e.data.shippingDiscount;
      }


      if (e.data.paymentIntent?.amount && parseFloat(total.toFixed(2)) != parseFloat((e.data.paymentIntent?.amount / 100).toFixed(2))) {

        console.log(parseFloat((e.data.paymentIntent?.amount / 100).toFixed(2)))
        console.log(parseFloat(total.toFixed(2)))
        e.rowElement.style.backgroundColor =  "yellow";
      }
    }
  }

  customizeAmount(itemInfo){
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(parseFloat((itemInfo.value / 100).toFixed(2)));
  }

  isVisible(roles: string[]): boolean {
    let userRole = this.authService.getLoggedInUser().role;

    return roles.filter(role => role == userRole).length > 0;
  }

  exportXLSGrid = () => {
    const context = this;

    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('Attendees');

    exportXLSDataGrid({
      component: context.purchasesGrid.instance,
      worksheet,
      autoFilterEnabled: true,
    }).then(() => {
      workbook.xlsx.writeBuffer().then((buffer) => {
        saveAs(new Blob([buffer], { type: 'application/octet-stream' }), 'purchases.xlsx');
      });
    });
  }
}
