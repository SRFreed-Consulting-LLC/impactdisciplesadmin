import { Injectable } from '@angular/core';
import { CustomerModel } from 'src/app/common/models/domain/utils/customer.model';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { BaseService } from './base.service';
import { CheckoutForm } from 'src/app/common/models/utils/cart.model';
import { PHONE_TYPES } from 'src/app/common/lists/phone_types.enum';
import { Role } from 'src/app/common/lists/roles.enum';
import { Address } from 'src/app/common/models/domain/utils/address.model';
import { Phone } from 'src/app/common/models/domain/utils/phone.model';
import { notify } from 'src/app/common/utils/notify.util';

@Injectable({
  providedIn: 'root'
})
export class CustomerService extends BaseService<CustomerModel>{
  constructor(public override dao: FirebaseDAO<CustomerModel>) {
    super(dao)
    this.table="customers"
  }


  async createCustomerAccount(checkoutForm: CheckoutForm){
    return await this.getAllByValue('email', checkoutForm.email).then(async users => {
      if(users && users.length == 0){
        const newUser: CustomerModel = {... new CustomerModel()};
        newUser.firstName = checkoutForm.firstName;
        newUser.lastName = checkoutForm.lastName;
        newUser.email = checkoutForm.email;

        const billingAddress = {... new Address()};
        billingAddress.address1 = checkoutForm.billingAddress.address1;
        billingAddress.address2 = checkoutForm.billingAddress.address2 ? checkoutForm.billingAddress.address2 :  '';
        billingAddress.city = checkoutForm.billingAddress.city;
        billingAddress.state = checkoutForm.billingAddress.state;
        billingAddress.zip = checkoutForm.billingAddress.zip;
        billingAddress.country = checkoutForm.billingAddress.country;

        newUser.billingAddress = billingAddress;

        const shippingAddress = {... new Address()};
        shippingAddress.address1 = checkoutForm.shippingAddress.address1;
        shippingAddress.address2 = checkoutForm.shippingAddress.address2 ? checkoutForm.billingAddress.address2 :  '';
        shippingAddress.city = checkoutForm.shippingAddress.city;
        shippingAddress.state = checkoutForm.shippingAddress.state;
        shippingAddress.zip = checkoutForm.shippingAddress.zip;
        shippingAddress.country = checkoutForm.shippingAddress.country;

        if(checkoutForm.isShippingSameAsBilling){
          newUser.shippingAddress = billingAddress;
        } else {
          const shippingAddress = {... new Address()};
          shippingAddress.address1 = checkoutForm.shippingAddress.address1;
          shippingAddress.address2 = checkoutForm.shippingAddress.address2 ? checkoutForm.billingAddress.address2 :  '';
          shippingAddress.city = checkoutForm.shippingAddress.city;
          shippingAddress.state = checkoutForm.shippingAddress.state;
          shippingAddress.zip = checkoutForm.shippingAddress.zip;
          shippingAddress.country = checkoutForm.shippingAddress.country;

          newUser.shippingAddress = shippingAddress;
        }

        const phone = {... new Phone()}
        phone.countryCode = '1';
        phone.number = checkoutForm.phone.number;
        phone.extension = PHONE_TYPES.CELL;

        newUser.phone = phone;

        newUser.role = Role.CUSTOMER;
        return await this.add(newUser);
      } else  {
        notify({
          message: 'An account with this email already exists.',
          position: 'top',
          type: 'warning'
        });

        return null;
      }
    })
  }
}
