import { Timestamp } from 'firebase/firestore';
import { BaseModel } from "src/app/common/models/base.model";
import { Address } from "src/app/common/models/domain/utils/address.model";
import { Phone } from "src/app/common/models/domain/utils/phone.model";
import { UNIT_OF_MEASURE } from 'src/app/common/lists/unit_of_measure.enum';
import { IClientAuthorizeCallbackData } from 'ngx-paypal';

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
  img?: any;
  attendees?: Attendee[];
  dateProcessed?: Timestamp;
  processedStatus?: string;
  weight?: number;
  uom?: UNIT_OF_MEASURE;
  eBookUrl?: any;
  size?: string;
  color?: string;
  language?: string;
  followUpEmailId?: string;
}

// The 5-step physical-fulfillment workflow (Store Manager > Fulfillment) -
// see fulfillment-steps.ts for the label/step-number mapping. 'new' is set
// automatically on order creation (server-side, see
// functions/src/purchase-fulfillment.functions.ts); every other status is a
// manual admin action. 'received' -> 'closed' is a valid direct jump (the
// pickup/hand-delivery override - skips shipping-label/packaging entirely).
// Distinct from CheckoutForm.processedStatus (payment state:
// NEW/COMPLETE/REFUNDED) and newRecordStatus (the new-record alert badge) -
// three separate concerns that happen to all live on the same document.
export type FulfillmentStatus = 'new' | 'received' | 'shipping_label_printed' | 'awaiting_shipping' | 'closed';

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
  processedStatus?: string;

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
  shippingRateId?: any;
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
  shippingLabel?: any;

  refundAmount?: number = 0;
  refundId?: string;

  // Distinct from processedStatus above (payment/fulfillment state) - this
  // tracks the new-record alert badge instead. See
  // EventRegistrationModel.newRecordStatus for what sets/clears it.
  newRecordStatus?: 'new' | 'seen';

  // Set server-side (functions/src/purchase-fulfillment.functions.ts) on
  // creation, only when this order has at least one physical line item -
  // undefined means this purchase never enters the Fulfillment workflow at
  // all (ebook/digital/event-only orders).
  fulfillmentStatus?: FulfillmentStatus;
}
