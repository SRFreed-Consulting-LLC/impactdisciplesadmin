import { LoggerService } from './logger.service';
import { Injectable } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { environment } from 'src/environments/environment';
import { BaseService } from './base.service';
import { ShippingLabelRequest } from 'src/app/common/models/domain/shipment-label-batch-request.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { Timestamp } from 'firebase/firestore';
import { Package, RateOptions, ShippingModel, ShippingRequest, WeightDetail } from '@impact-common/shared/models/domain/shipment.model';
import { UNIT_OF_MEASURE } from '@impact-common/shared/lists/unit_of_measure.enum';


@Injectable({
  providedIn: 'root'
})
export class ShippingLabelService extends BaseService<ShippingLabelRequest>{

  constructor(public override dao: FirebaseDAO<ShippingLabelRequest>, private logService: LoggerService) {
    super(dao)
    this.table="shipping-labels"
    this.fromFirestore = ShippingLabelService.fromFirestore
  }

  static readonly fromFirestore = (data): ShippingLabelRequest => {
    data.requestedDate = dateFromTimestamp(data.requestedDate as Timestamp)
    data.purchasedDate = dateFromTimestamp(data.purchasedDate as Timestamp)
    return data;
  };

  public async createRequest(shippingLabel: ShippingLabelRequest){
    const shippingRequest = shippingLabel.request;

    const rateOptions = {... new RateOptions()};
    rateOptions.carrierIds = environment.shippingCarriers;
    shippingRequest.rateOptions = rateOptions;

    const shipment = {... new ShippingModel()};
    shipment.validateAddress = "no_validation";
    shipment.packages = [];
    shipment.shipFrom = shippingLabel.request.shipment.shipFrom
    shipment.shipTo = shippingLabel.request.shipment.shipTo
    shippingRequest.shipment = shipment;

    const pkg: Package = {... new Package()};
    pkg.weight = {...new WeightDetail()};
    pkg.weight.unit = UNIT_OF_MEASURE.OUNCE;
    pkg.weight.value = shippingLabel.request.weight? shippingLabel.request.weight : 0;
    shipment.packages.push(pkg);

    return this.makeRequest(shippingRequest).then(result => {
      shippingLabel.requestedDate = new Date();

      if (result) {
        result.rateResponse.rates.sort((a, b) => a.shippingAmount.amount - b.shippingAmount.amount);

        shippingLabel.shippingRateId = {... result.rateResponse.rates[0]};

        shippingLabel.shippingRate = Number(Number(result.rateResponse.rates[0].shippingAmount.amount).toFixed(2));

        shippingLabel.status = "CREATED"

        return this.update(shippingLabel.id, shippingLabel)
      } else {
        shippingLabel.status = "FAILED";

        return this.update(shippingLabel.id, shippingLabel)
      }
    }).catch(e => {
      shippingLabel.status = "FAILED";
      shippingLabel.message = {... e};

      return this.update(shippingLabel.id, shippingLabel)
    })
  }

  public async makeRequest(request: ShippingRequest){
    const response = await fetch(environment.shippingUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      this.logService.logMessage('SHIPPING REQUEST', request.shipment.shipTo.name, 'Error receieved from ShippingService: ', JSON.stringify(response));

      throw new Error('Failed to get Shipping Rates: ' + JSON.stringify(response));
    }

    const rate = await response.json();

    return rate;
  }
}
