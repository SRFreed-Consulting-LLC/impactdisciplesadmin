import { FormControl, FormGroup } from '@angular/forms';
import { FormFieldDef } from '@impact-common/shared/models/domain/form-field.model';
import { buildFormGroup } from './build-form-group';

// Pure function - no DI at all, so no TestBed needed here.
//
// This builds the FormGroup behind every custom form the Form Builder
// produces, so a mistake shows up as a field that can never be filled in or
// a submission missing a value, on a form an admin authored rather than a
// developer.

const field = (over: Partial<FormFieldDef>): FormFieldDef =>
  ({ id: 'f1', type: 'text', label: 'Field', ...over }) as FormFieldDef;

describe('buildFormGroup', () => {
  describe('control creation', () => {
    it('keys controls by field id, flat, whatever the nesting', () => {
      const group = buildFormGroup([
        field({ id: 'firstName' }),
        field({ id: 'lastName' }),
      ], false);
      expect(Object.keys(group.controls).sort()).toEqual(['firstName', 'lastName']);
    });

    it('starts a plain text field as an empty string', () => {
      const group = buildFormGroup([field({ id: 'note' })], false);
      expect(group.get('note')!.value).toBe('');
    });

    it('starts a checkbox as false, not empty string', () => {
      const group = buildFormGroup([field({ id: 'agree', type: 'checkbox' })], false);
      expect(group.get('agree')!.value).toBeFalse();
    });

    it('starts a checkbox GROUP as an empty array', () => {
      const group = buildFormGroup([field({ id: 'picks', type: 'checkboxes' })], false);
      expect(group.get('picks')!.value).toEqual([]);
    });

    it('starts a date as null, since mat-datepicker rejects an empty string', () => {
      const group = buildFormGroup([field({ id: 'when', type: 'date' })], false);
      expect(group.get('when')!.value).toBeNull();
    });
  });

  describe('composite fields', () => {
    it('builds address as its own nested group with the five parts', () => {
      const group = buildFormGroup([field({ id: 'home', type: 'address' })], false);
      const address = group.get('home') as FormGroup;
      expect(address instanceof FormGroup).toBeTrue();
      expect(Object.keys(address.controls).sort())
        .toEqual(['address1', 'address2', 'city', 'state', 'zip']);
    });

    it('builds phone as its own nested group', () => {
      const group = buildFormGroup([field({ id: 'mobile', type: 'phone' })], false);
      const phone = group.get('mobile') as FormGroup;
      expect(phone instanceof FormGroup).toBeTrue();
      expect(Object.keys(phone.controls).sort()).toEqual(['countryCode', 'number', 'type']);
    });
  });

  describe('layout fields', () => {
    it('creates no control for structural fields', () => {
      // heading/instructions/image/divider carry no submitted value; a
      // control for them would put junk in every submission.
      const group = buildFormGroup([
        field({ id: 'h', type: 'heading' }),
        field({ id: 'note', type: 'instructions' }),
        field({ id: 'rule', type: 'divider' }),
        field({ id: 'real' }),
      ], false);
      expect(Object.keys(group.controls)).toEqual(['real']);
    });

    it('recurses into every column of a columns container without controlling the container', () => {
      const group = buildFormGroup([
        field({
          id: 'row1',
          type: 'columns',
          columns: [
            { fields: [field({ id: 'left' })] },
            { fields: [field({ id: 'right' })] },
          ],
        } as Partial<FormFieldDef>),
      ], false);

      expect(Object.keys(group.controls).sort()).toEqual(['left', 'right']);
      expect(group.get('row1')).toBeNull();
    });

    it('handles a columns field with no columns at all', () => {
      const group = buildFormGroup([field({ id: 'row1', type: 'columns' })], false);
      expect(Object.keys(group.controls)).toEqual([]);
    });

    it('recurses through columns nested in columns', () => {
      const group = buildFormGroup([
        field({
          id: 'outer',
          type: 'columns',
          columns: [{
            fields: [field({
              id: 'inner',
              type: 'columns',
              columns: [{ fields: [field({ id: 'deep' })] }],
            } as Partial<FormFieldDef>)],
          }],
        } as Partial<FormFieldDef>),
      ], false);
      expect(Object.keys(group.controls)).toEqual(['deep']);
    });
  });

  describe('validators', () => {
    it('leaves a required field valid when validators are off', () => {
      // The builder's Live Preview never submits, so it must not show
      // "required" errors on a form the author is still editing.
      const group = buildFormGroup([field({ id: 'name', required: true })], false);
      expect(group.get('name')!.valid).toBeTrue();
    });

    it('marks a required field invalid when validators are on', () => {
      const group = buildFormGroup([field({ id: 'name', required: true })], true);
      expect(group.get('name')!.valid).toBeFalse();
    });

    it('leaves an optional field valid either way', () => {
      const group = buildFormGroup([field({ id: 'name', required: false })], true);
      expect(group.get('name')!.valid).toBeTrue();
    });

    it('requires a required checkbox to be TICKED, not merely present', () => {
      const group = buildFormGroup([field({ id: 'agree', type: 'checkbox', required: true })], true);
      const control = group.get('agree') as FormControl;
      expect(control.valid).toBeFalse();
      control.setValue(true);
      expect(control.valid).toBeTrue();
    });

    it('requires the meaningful parts of an address, but not address2', () => {
      const group = buildFormGroup([field({ id: 'home', type: 'address', required: true })], true);
      const address = group.get('home') as FormGroup;
      expect(address.get('address1')!.valid).toBeFalse();
      expect(address.get('city')!.valid).toBeFalse();
      expect(address.get('address2')!.valid).toBeTrue();
    });

    it('requires a phone number but not its country code or type', () => {
      const group = buildFormGroup([field({ id: 'mobile', type: 'phone', required: true })], true);
      const phone = group.get('mobile') as FormGroup;
      expect(phone.get('number')!.valid).toBeFalse();
      expect(phone.get('countryCode')!.valid).toBeTrue();
      expect(phone.get('type')!.valid).toBeTrue();
    });

    it('applies required through a columns container too', () => {
      const group = buildFormGroup([
        field({
          id: 'row',
          type: 'columns',
          columns: [{ fields: [field({ id: 'nested', required: true })] }],
        } as Partial<FormFieldDef>),
      ], true);
      expect(group.get('nested')!.valid).toBeFalse();
    });
  });

  describe('edge cases', () => {
    it('returns an empty group for no fields', () => {
      expect(Object.keys(buildFormGroup([], true).controls)).toEqual([]);
    });
  });
});
