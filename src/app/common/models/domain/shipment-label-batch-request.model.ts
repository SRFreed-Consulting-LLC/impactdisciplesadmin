import { BaseModel } from '../base.model';
import { ShippingFromAddress, ShippingRequest } from './shipment.model';

export class ShippingLabelBatchRequest extends BaseModel {
  createdDate: Date;
  requestDate: Date;
  createdBy: string;
  batchNumber: string;
  shipFrom: ShippingFromAddress;
}

export class ShippingLabelRequest extends BaseModel {
  batchId: string;
  request: ShippingRequest;
  requestedDate: Date;
  purchasedDate: Date;
  shippingRateId: any;
  shippingRate: number;
  status: string;
  message: string;
  shippingLabel?: any;
}
