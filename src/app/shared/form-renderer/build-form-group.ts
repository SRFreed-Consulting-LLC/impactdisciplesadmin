import { FormControl, FormGroup, Validators } from '@angular/forms';
import { FIELD_TYPE_META, FormFieldDef } from '@impact-common/shared/models/domain/form-field.model';

// Builds one flat top-level FormGroup for a whole fields[] tree, keyed by
// each data field's own id - including fields nested inside a 'columns'
// container, which recurses into both column arrays but never becomes a
// control itself (it's structural, not a value). Address/Phone are the two
// exceptions that are themselves nested FormGroups, matching what
// AddressFieldComponent/PhoneFieldComponent's own [group] input expects.
//
// applyValidators is false for the builder's Live Preview (nothing is ever
// actually submitted there, and a disabled preview shouldn't show
// "required" errors) and true for the real Preview & Test Submit fill flow.
export function buildFormGroup(fields: FormFieldDef[], applyValidators: boolean): FormGroup {
  const group = new FormGroup({});
  addControls(fields, group, applyValidators);
  return group;
}

function addControls(fields: FormFieldDef[], group: FormGroup, applyValidators: boolean): void {
  for (const field of fields) {
    if (field.type === 'columns') {
      (field.columns ?? []).forEach((column) => addControls(column.fields, group, applyValidators));
      continue;
    }
    if (FIELD_TYPE_META[field.type].isLayout) {
      continue; // heading/instructions/image/divider - structural, no submitted value.
    }

    const required = applyValidators && !!field.required;

    if (field.type === 'address') {
      group.addControl(
        field.id,
        new FormGroup({
          address1: new FormControl('', required ? [Validators.required] : []),
          address2: new FormControl(''),
          city: new FormControl('', required ? [Validators.required] : []),
          state: new FormControl('', required ? [Validators.required] : []),
          zip: new FormControl('', required ? [Validators.required] : [])
        })
      );
      continue;
    }

    if (field.type === 'phone') {
      group.addControl(
        field.id,
        new FormGroup({
          countryCode: new FormControl(''),
          number: new FormControl('', required ? [Validators.required] : []),
          type: new FormControl(null)
        })
      );
      continue;
    }

    if (field.type === 'checkbox') {
      group.addControl(field.id, new FormControl(false, required ? [Validators.requiredTrue] : []));
      continue;
    }

    if (field.type === 'checkboxes') {
      group.addControl(field.id, new FormControl<string[]>([], required ? [Validators.required] : []));
      continue;
    }

    if (field.type === 'date') {
      // mat-datepicker expects a real Date|null, not '' - see
      // form-renderer-field.component.ts's use of matDatepicker for this type.
      group.addControl(field.id, new FormControl<Date | null>(null, required ? [Validators.required] : []));
      continue;
    }

    group.addControl(field.id, new FormControl('', required ? [Validators.required] : []));
  }
}
