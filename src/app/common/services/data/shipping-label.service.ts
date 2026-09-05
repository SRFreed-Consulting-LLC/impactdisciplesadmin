import { LoggerService } from './logger.service';
import { Injectable } from '@angular/core';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { environment } from 'src/environments/environment';
import { BaseService } from './base.service';
import { ShippingLabelRequest } from '@impact-common/shared/models/domain/shipment-label-batch-request.model';
import { dateFromTimestamp } from '@impact-common/shared/utils/date-from-timestamp';
import { Package, RateOptions, ShippingModel, ShippingRequest, WeightDetail } from '@impact-common/shared/models/domain/shipment.model';
import { UNIT_OF_MEASURE } from '@impact-common/shared/lists/unit_of_measure.enum';

// The slice of a ShipEngine rate this service reads; the full row is what
// gets stored on shippingRateId.
interface RateRow {
  rateId: string;
  shippingAmount: { amount: number };
  [key: string]: unknown;
}

@Injectable({
  providedIn: 'root'
})
export class ShippingLabelService extends BaseService<ShippingLabelRequest>{

  constructor(public override dao: FirebaseDAO<ShippingLabelRequest>, private logService: LoggerService) {
    super(dao)
    this.table="shipping-labels"
    this.fromFirestore = ShippingLabelService.fromFirestore
  }

  static readonly fromFirestore = (data: ShippingLabelRequest): ShippingLabelRequest => {
    data.requestedDate = dateFromTimestamp(data.requestedDate)
    data.purchasedDate = dateFromTimestamp(data.purchasedDate)
    return data;
  };

  public async createRequest(shippingLabel: ShippingLabelRequest){
    // Every branch below ends in update(id, ...). Without an id that used to
    // write to a document literally named "undefined" (strict null checks,
    // 2026-09-05, made the hole visible); refusing is the honest outcome.
    const id = shippingLabel.id;
    if (!id) {
      throw new Error('ShippingLabelService.createRequest: the request has no id');
    }
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
        const rates: RateRow[] = result.rateResponse.rates;
        rates.sort((a, b) => a.shippingAmount.amount - b.shippingAmount.amount);

        shippingLabel.shippingRateId = {... rates[0]};

        shippingLabel.shippingRate = Number(Number(rates[0].shippingAmount.amount).toFixed(2));

        shippingLabel.status = "CREATED"

        return this.update(id, shippingLabel)
      } else {
        shippingLabel.status = "FAILED";

        return this.update(id, shippingLabel)
      }
    }).catch(e => {
      shippingLabel.status = "FAILED";
      shippingLabel.message = {... e};

      return this.update(id, shippingLabel)
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
