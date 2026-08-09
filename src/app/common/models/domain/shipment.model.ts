import { UNIT_OF_MEASURE } from 'src/app/common/lists/unit_of_measure.enum';
import { BaseModel } from '../base.model';

export class ShippingRequest {
  rateOptions: RateOptions;
  shipment: ShippingModel;
  weight: number;
}
export class ShippingModel extends BaseModel {
  validateAddress: string = "no_validation";
  shipTo: ShippingToAddress = {... new ShippingToAddress()};
  shipFrom: ShippingFromAddress = {... new ShippingFromAddress()};
  packages: Package[] = [];
}

export class ShippingToAddress {
  name: string;
  phone: string;
  addressLine1: string;
  cityLocality: string;
  stateProvince: string;
  postalCode: string;
  countryCode: string;
  addressResidentialIndicator: string;
}

export class ShippingFromAddress {
  companyName: string;
  name?: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  cityLocality: string;
  stateProvince: string;
  postalCode: string;
  countryCode: string;
  addressResidentialIndicator: string;
}
export class Package {
  weight: WeightDetail;
}

export class WeightDetail{
  value: number;
  unit: UNIT_OF_MEASURE
}

export class RateOptions {
  carrierIds: string[] = []
}



