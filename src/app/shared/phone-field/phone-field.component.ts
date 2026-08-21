import { Component, Input } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { PHONE_TYPES } from '@impact-common/shared/lists/phone_types.enum';
import { EnumHelper } from '@impact-common/shared/utils/enum_helper';

// Reusable "Phone" sub-form fragment (Country Code / Number / Type), the
// Material equivalent of the dx-form "Phone" group repeated across
// Organizations, Locations, and Users. Takes the nested FormGroup as an
// @Input() rather than being a ControlValueAccessor - simplest way to let a
// parent form own a `phone: fb.group({...})` control while sharing the
// rendering. [formGroup] on this component's own host element still reaches
// formControlName bindings inside it (directives compose across component
// boundaries), the same pattern PopupHeaderComponent already relies on for
// its projected content.
@Component({
    selector: 'app-phone-field',
    templateUrl: './phone-field.component.html',
    styleUrls: ['./phone-field.component.scss'],
    standalone: false
})
export class PhoneFieldComponent {
  @Input() group: FormGroup;
  @Input() phoneTypes: PHONE_TYPES[] = EnumHelper.getPhoneTypesAsArray();
}
