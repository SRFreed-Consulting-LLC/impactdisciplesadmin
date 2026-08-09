import { BaseModel } from "../../base.model";
import { Address } from "../utils/address.model";
import { Phone } from "../utils/phone.model";

export class Person extends BaseModel {
    firstName: string;
    lastName: string;

    shippingAddress: Address;
    billingAddress: Address;
    phone: Phone;

    constructor(){
      super();
    }
}
