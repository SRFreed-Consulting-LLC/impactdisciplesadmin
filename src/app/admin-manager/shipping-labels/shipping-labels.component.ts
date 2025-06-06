import { Component, OnInit, ViewChild } from '@angular/core';
import { ShippingLabelBatchRequest, ShippingLabelRequest } from 'impactdisciplescommon/src/models/domain/shipment-label-batch-request.model';
import { ShippingLabelBatchService } from 'impactdisciplescommon/src/services/data/shipping-label-batch.service';
import { AuthService } from 'impactdisciplescommon/src/services/utils/auth.service';
import { BehaviorSubject, map, Observable } from 'rxjs';
import { confirm } from 'devextreme/ui/dialog';
import notify from 'devextreme/ui/notify';
import DataSource from 'devextreme/data/data_source';
import CustomStore from 'devextreme/data/custom_store';
import { ShippingLabelService } from 'impactdisciplescommon/src/services/data/shipping-label.service';
import { EnumHelper } from 'impactdisciplescommon/src/utils/enum_helper';
import { WebConfigService } from 'impactdisciplescommon/src/services/data/web-config.service';
import { WebConfigModel } from 'impactdisciplescommon/src/models/utils/web-config.model';
import { ShippingFromAddress } from 'impactdisciplescommon/src/models/domain/shipment.model';
import { ShippingLabelListComponent } from './shippingLabelList/shippingLabelList.component';

@Component({
  selector: 'app-shipping-labels',
  templateUrl: './shipping-labels.component.html',
  styleUrls: ['./shipping-labels.component.css']
})
export class ShippingLabelsComponent implements OnInit {
  @ViewChild('shippinglabellist', { static: false }) shippinglabellist: ShippingLabelListComponent;

  batchDatasource$: Observable<DataSource>;

  public isLabelsVisible$ = new BehaviorSubject<boolean>(false);
  public isFromAddressVisible$ = new BehaviorSubject<boolean>(false);
  public isResultsVisible$ = new BehaviorSubject<boolean>(false);

  public inProgress$ = new BehaviorSubject<boolean>(false);

  selectedBatch: ShippingLabelBatchRequest;

  labelResults: ShippingLabelRequest[];


  itemType = 'Shipping Label Batch';

  public states: { key: string; value: string; }[];
  public countries: { key: string; value: string; }[];

  config: WebConfigModel;

  constructor(private authService: AuthService,
    private batchService: ShippingLabelBatchService,
    private labelService: ShippingLabelService,
    private webConfigService: WebConfigService) { }

  ngOnInit() {
    this.batchDatasource$ = this.batchService.streamAll().pipe(
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
          }
        )
      )
    );

    this.states = EnumHelper.getState2LetterTypesAsArray().map((k, v) => {return {key: k[0], value:k[1]}});
    this.countries = EnumHelper.getCountry2LetterTypesAsArray().map((k, v) => {return {key: k[0], value:k[1]}});
  }

  addBatch = () => {
    let batchRequest = {... new ShippingLabelBatchRequest()};
    batchRequest.createdDate = new Date();
    batchRequest.createdBy = this.authService.getLoggedInUser().email;

    this.batchService.add(batchRequest).then(batch => {
      this.selectedBatch = batch;

      this.openBatchModal();
    })
  }

  editBatch = (e) => {
    this.selectedBatch = (Object.assign({}, e.data));
    this.openBatchModal();
  }

  saveFromAddress(){
    this.batchService.update(this.selectedBatch.id, this.selectedBatch).then(batch => {
      notify({
        message: 'From Address Saved',
        position: 'top',
        width: 600,
        type: 'success'
      });
      this.isFromAddressVisible$.next(false);
    })
  }

  deleteBatch = ({ row: { data } }) => {
    confirm('<i>Are you sure you want to delete this batch?</i>', 'Confirm').then((dialogResult) => {
      if (dialogResult) {
        this.labelService.getAllByValue('batchId', data.id).then(labels => {
          labels.forEach(async label => {
            await this.labelService.delete(label.id)
          })
        }).then(() =>{
          this.batchService.delete(data.id).then(() => {
            notify({
              message: this.itemType + ' Deleted',
              position: 'top',
              width: 600,
              type: 'success'
            });
          })
        })
      }
    });
  }

  openBatchModal() {
    this.inProgress$.next(false);
    this.isLabelsVisible$.next(true);
  }

  closeBatchModal() {
    this.inProgress$.next(false);
    this.isLabelsVisible$.next(false);
  }

  openResultsModal() {
    this.inProgress$.next(false);
    this.isResultsVisible$.next(true);
  }

  closeResultsModal(){
    this.inProgress$.next(false);
    this.isResultsVisible$.next(false);
  }

  setFromAddress(){
    this.webConfigService.getAll().then(configs => {
      let shipFrom = {... new ShippingFromAddress()};
      shipFrom.name = "Impact Disciples";
      shipFrom.phone = configs[0].phone;
      shipFrom.addressLine1 = configs[0].address.address1;
      shipFrom.cityLocality = configs[0].address.city;
      shipFrom.stateProvince = "GA";
      shipFrom.postalCode = configs[0].address.zip;
      shipFrom.countryCode = "US";
      this.selectedBatch.shipFrom = shipFrom;

      this.inProgress$.next(false);
      this.isFromAddressVisible$.next(true);
    })
  }

  closeFromAddressModal() {
    this.inProgress$.next(false);
    this.isFromAddressVisible$.next(false);
  }

  generateShippingLabels(){
    if(!this.selectedBatch.shipFrom){
      notify('Please verify the return address is correct before generating Shipping Labels')
    } else {
      confirm('<i>Are you sure you want to create these Shipping Labels?</i>', 'Confirm').then((dialogResult) => {
        if (dialogResult) {
          this.labelResults = [];

          this.labelService.getAllByValue('batchId', this.selectedBatch.id).then(labels => {
            this.shippinglabellist.startCustomLoading();
            let promises: Promise<ShippingLabelRequest>[] = []

            labels.forEach(async label => {
              if(label.status == "NEW" || label.status == "FAILED"){
                label.request.shipment.shipFrom = this.selectedBatch.shipFrom;

                promises.push(this.labelService.createRequest(label));
              }
            })

            Promise.all(promises).then((labels) => {
              this.labelResults = labels;
              this.shippinglabellist.stopCustomLoading();
              this.openResultsModal()
            })
          })
        }
      });
    }
  }

  getCount(results: ShippingLabelRequest[], status: string){
    let statusResults = results.filter(label => label.status == status);
    return statusResults? statusResults.length : 0;
  }
}
