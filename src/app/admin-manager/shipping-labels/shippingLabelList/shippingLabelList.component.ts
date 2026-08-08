import { Component, Input, OnInit, ViewChild } from '@angular/core';
import { DxDataGridComponent } from 'devextreme-angular';
import CustomStore from 'devextreme/data/custom_store';
import DataSource from 'devextreme/data/data_source';
import notify from 'devextreme/ui/notify';
import { ShippingLabelRequest } from 'impactdisciplescommon/src/models/domain/shipment-label-batch-request.model';
import { ShippingModel, ShippingRequest, ShippingToAddress } from 'impactdisciplescommon/src/models/domain/shipment.model';
import { ShippingLabelService } from 'impactdisciplescommon/src/services/data/shipping-label.service';
import { EnumHelper } from 'impactdisciplescommon/src/utils/enum_helper';
import { Observable, map, merge } from 'rxjs';
import { environment } from 'src/environments/environment';
import { AdminAuthService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';
import _ from 'lodash';

@Component({
    selector: 'app-shippingLabelList',
    templateUrl: './shippingLabelList.component.html',
    styleUrls: ['./shippingLabelList.component.css'],
    standalone: false
})
export class ShippingLabelListComponent implements OnInit {
  @ViewChild('addressGrid', { static: false }) addressGrid: DxDataGridComponent;

  @Input('batchId') batchId: string;
  batchDatasource$: Observable<DataSource>;

  public states: { key: string; value: string; }[];
  public countries: { key: string; value: string; }[];

  constructor(private labelService: ShippingLabelService, private authService: AdminAuthService) { }

  ngOnInit() {
    let that = this;

    this.batchDatasource$ = this.labelService.streamAllByValue('batchId', this.batchId).pipe(
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
              },
              insert(value) {
                value.batchId = that.batchId;
                value.status = "NEW";
                return that.labelService.add(value);
              },
              update(key, value) {
                value.batchId = that.batchId;
                return that.labelService.update(key, value);
              },
              remove(key) {
                return that.labelService.delete(key);
              },
            })
          })
        )
      );

      this.states = EnumHelper.getState2LetterTypesAsArray().map((k, v) => {return {key: k[0], value:k[1]}});
      this.countries = EnumHelper.getCountry2LetterTypesAsArray().map((k, v) => {return {key: k[0], value:k[1]}});
  }

  onInitNewRow(e){
    e.data = {...new ShippingLabelRequest()}
    e.data.request = {...new ShippingRequest()}
    e.data.request.shipment = {... new ShippingModel()}
    e.data.request.shipment.shipTo = {... new ShippingToAddress()}
    e.data.request.shipment.shipTo.stateProvince = "GA";
    e.data.request.shipment.shipTo.countryCode = "US";
  }

  onRowUpdating(options) {
    _.merge(options.newData, options.oldData)
  }

  isShippingButtonVisible(e){
    return e.row.data?.shippingRate > 0;
  }

  downloadShippingLabel(pdf){
    this.stopCustomLoading()
    const link = document.createElement('a');
    link.setAttribute('target', '_blank');
    link.setAttribute('href', pdf);
    link.setAttribute('download', `shippinglabel.pdf`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  getShippingLabel = async (e) =>{
    this.startCustomLoading();

    if(!e.row.data?.shippingLabel){
      let data = { 'shipId': e.row.data.shippingRateId.rateId};

      // Purchasing a shipping label costs real postage -- this endpoint now
      // requires a verified staff Firebase ID token.
      let idToken = await this.authService.dao.auth.currentUser?.getIdToken();

      let request = await fetch(environment.shippingLabelUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + idToken },
        body: JSON.stringify(data)
      })

      let response = await request.json();

      if(response.code == 400){
        notify({
          message: response.error.message,
          position: 'top',
          width: 600,
          type: 'error'
        });


        e.row.data.message = response.error.message;
        e.row.data.status = "FAILED";
        e.row.data.shippingLabel = response;

        this.stopCustomLoading()
      } else {
        e.row.data.shippingLabel = response;

        e.row.data.status = "PURCHASED"

        e.row.data.purchasedDate = new Date();
        await this.labelService.update(e.row.data.id, e.row.data).then(sale => {
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

        this.stopCustomLoading()
      } else {
        this.downloadShippingLabel(e.row.data.shippingLabel.labelDownload.pdf)
      }
    }
  }

  startCustomLoading(){
    this.addressGrid.instance.beginCustomLoading("Requesting Shipping Estimates for Labels")
  }

  stopCustomLoading(){
    this.addressGrid.instance.endCustomLoading();
  }
}
