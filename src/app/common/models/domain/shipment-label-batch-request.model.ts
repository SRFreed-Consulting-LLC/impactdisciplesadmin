import { BaseModel } from '../base.model';
import { ShippingFromAddress, ShippingRequest } from './shipment.model';

export class ShippingLabelBatchRequest extends BaseModel {
  createdDate: Date;
  requestDate: Date;
  createdBy: string;
  batchNumber: string;
  shipFrom: ShippingFromAddress;
}

// The chosen rate from the shipping-rates response (ShippingLabelService's
// own result.rateResponse.rates[0], spread as-is) - only the fields actually
// read back off it downstream (shipping-batch-dialog.component.ts,
// purchases.service.ts) are modeled; the rest of the shipping provider's
// rate shape passes through untouched via the index signature.
export interface ShippingRate {
  rateId: string;
  shippingAmount: { amount: number };
  [key: string]: unknown;
}

// Raw response from environment.shippingLabelUrl - either a purchased label
// (labelDownload.pdf) or an error payload (code/error.message), per the
// branching in getShippingLabel()/purchases.service.ts's own label-purchase
// method.
export interface ShippingLabelResponse {
  code?: number | string;
  error?: { message: string };
  labelDownload?: { pdf: string };
  [key: string]: unknown;
}

export class ShippingLabelRequest extends BaseModel {
  batchId: string;
  request: ShippingRequest;
  requestedDate: Date;
  purchasedDate: Date;
  shippingRateId: ShippingRate;
  shippingRate: number;
  status: string;
  message: string;
  shippingLabel?: ShippingLabelResponse;
}
