import { Component, Input } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { EnumHelper } from '@impact-common/shared/utils/enum_helper';

// Reusable "Address" sub-form fragment, the Material equivalent of the
// dx-form "Address" group repeated across Organizations, Locations, and
// Users (which uses it twice, for Shipping and Billing). Same
// @Input() FormGroup pattern as PhoneFieldComponent.
// Country is opt-in via showCountry: Organizations and Locations never
// exposed a country editor in the original (the field exists on the model
// but was display-only there), while Users' shipping/billing addresses did.
@Component({
    selector: 'app-address-field',
    templateUrl: './address-field.component.html',
    styleUrls: ['./address-field.component.scss'],
    standalone: false
})
export class AddressFieldComponent {
  @Input() group: FormGroup;
  @Input() states: string[] = EnumHelper.getStateTypesAsArray();
  @Input() countries: string[] = EnumHelper.getCountryTypesAsArray();
  @Input() showCountry = false;
}
