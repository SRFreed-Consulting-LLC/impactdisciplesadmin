import { Timestamp } from 'firebase/firestore';
import { BaseModel } from "src/app/common/models/base.model";
import { Address } from "src/app/common/models/domain/utils/address.model";
import { Phone } from "src/app/common/models/domain/utils/phone.model";
import { UNIT_OF_MEASURE } from 'src/app/common/lists/unit_of_measure.enum';
import { IClientAuthorizeCallbackData } from 'ngx-paypal';
import { ImageModel } from 'src/app/common/models/utils/image.model';
import { ShippingLabelResponse, ShippingRate } from 'src/app/common/models/domain/shipment-label-batch-request.model';

export interface CartItem {
  id?: string;
  itemName?: string;
  price?: number;
  salePrice?: number;
  orderQuantity?: number;
  discount?: number;
  discountPrice?: number;
  isEvent?: boolean;
  isEBook?: boolean;
  isDigitalBook?: boolean;
  digitalBookId?: string;
  img?: ImageModel;
  attendees?: Attendee[];
  dateProcessed?: Timestamp;
  processedStatus?: string;
  weight?: number;
  uom?: UNIT_OF_MEASURE;
  eBookUrl?: ImageModel;
  size?: string;
  color?: string;
  language?: string;
  followUpEmailId?: string;
}

// The 5-step physical-fulfillment workflow (Store Manager > Fulfillment) -
// see fulfillment-steps.ts for the label/step-number mapping. Set
// automatically on order creation (server-side, see
// functions/src/purchase-fulfillment.functions.ts) - 'new' if the order has
// a physical line item, 'closed' otherwise (ebook/digital/event-only orders
// have nothing to ship, so they're already done); every other transition
// past that is a manual admin action. 'received' -> 'closed' is a valid
// direct jump (the pickup/hand-delivery override - skips shipping-label/
// packaging entirely).
//
// This is the only order-status field a purchase carries now - there used
// to be a separate CheckoutForm.processedStatus (payment state: NEW/
// COMPLETE/REFUNDED), removed in favor of this one being set on every
// purchase unconditionally. Still distinct from newRecordStatus below (the
// new-record alert badge) - a different, unrelated concern that happens to
// live on the same document.
export type FulfillmentStatus = 'new' | 'received' | 'shipping_label_printed' | 'awaiting_shipping' | 'closed';

// One entry per fulfillmentStatus transition, oldest first - backs the Sale
// Details tab's timeline (purchase-details.component.ts). The very first
// entry is stamped server-side at order creation (see
// functions/src/purchase-fulfillment.functions.ts); every entry after that
// is appended by PurchasesService's own transition methods
// (acknowledgeOrder/getShippingLabel/markPackaged/markShipped/markPickedUp)
// as part of the same full-object update() that changes fulfillmentStatus -
// never a separate write, so the two can't drift apart. `by` is the acting
// admin's display name/email (absent on the creation entry - nobody "did"
// that one). Purchases created before this field existed simply have no
// statusHistory at all - the timeline UI falls back to just dateProcessed +
// the current status for those, rather than inventing history that was
// never recorded.
export interface StatusHistoryEntry {
  status: FulfillmentStatus;
  date: Timestamp;
  by?: string;
}

export interface Attendee {
  firstName: string;
  lastName: string;
  email: string;
  receipt?: string;
}

export class CheckoutForm extends BaseModel {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: Phone;
  isShippingSameAsBilling?: boolean;
  billingAddress?: Address;
  shippingAddress?: Address;
  cartItems?: CartItem[];
  receipt?: string;
  isNewsletter?: boolean;
  isCreateAccount?: boolean;
  payPalReceipt?: IClientAuthorizeCallbackData;
  dateProcessed?: Timestamp;

  //total sale amount
  total?: number = 0;
  //total discount on items
  discount?: number = 0;
  //code for coupon
  couponCode?: string;
  //coupon discount percentage
  couponPercent?: number;
  //amount charged for shipping
  shippingRate?: number = 0;
  //id of shipping rate used
  shippingRateId?: ShippingRate;
  //amount of shipping discount
  shippingDiscount?: number = 0;
  //shipping discount reason
  shippingDiscountReason?: string;
  //amount charged for taxes
  estimatedTaxes?: number = 0;
  //percent used to figure taxes
  taxRate?: number = 0;
  //service rate or default rate
  taxSource?: string;

  //url to shipping label
  shippingLabel?: ShippingLabelResponse;

  refundAmount?: number = 0;
  refundId?: string;

  // Pre-prod #6 (refundStorePurchase Cloud Function): full-order refund
  // state. licensesRevoked records which digital-book licenses were
  // stripped alongside the refund (empty when the admin unchecked it).
  refunded?: boolean;
  refundedAt?: Timestamp | Date;
  refundedBy?: string;
  refundStatus?: string;
  licensesRevoked?: string[];

  // Distinct from fulfillmentStatus (order-status field, see its own
  // comment above) - this tracks the new-record alert badge instead. See
  // EventRegistrationModel.newRecordStatus for what sets/clears it.
  newRecordStatus?: 'new' | 'seen';

  // Set server-side (functions/src/purchase-fulfillment.functions.ts) on
  // creation, for every purchase unconditionally - see FulfillmentStatus's
  // own comment above for what determines 'new' vs 'closed'.
  fulfillmentStatus?: FulfillmentStatus;

  // See StatusHistoryEntry's own comment above.
  statusHistory?: StatusHistoryEntry[];
}
