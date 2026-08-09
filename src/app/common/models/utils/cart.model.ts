import { Timestamp } from 'firebase/firestore';
import { PaymentIntent } from "@stripe/stripe-js";
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
  paymentIntent?: PaymentIntent | string;
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
}
