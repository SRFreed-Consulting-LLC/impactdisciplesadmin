import { Component, Input } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { EnumHelper } from '@impact-common/shared/utils/enum_helper';

/** A picker entry: the code that gets stored, the name that gets shown. */
export interface CodedOption {
  code: string;
  name: string;
}

/** @deprecated Kept as an alias so existing imports keep compiling. */
export type StateOption = CodedOption;

// Reusable "Address" sub-form fragment, the Material equivalent of the
// dx-form "Address" group repeated across Organizations, Locations, and
// Users (which uses it twice, for Shipping and Billing). Same
// @Input() FormGroup pattern as PhoneFieldComponent.
// Country is opt-in via showCountry: Organizations and Locations never
// exposed a country editor in the original (the field exists on the model
// but was display-only there), while Users' shipping/billing addresses did.
//
// STATE AND COUNTRY STORE A CODE, DISPLAY A NAME (2026-09-04). Both pickers
// used to do both with the full name, which is how `customers` and
// `purchases` ended up spelling the same state two ways, and how every
// address in the app came to hold "United States" where the shipping vendor
// requires "US" - see scripts/lib/state-code.js and country-code.js for what
// each cost. Ten screens share this component and none override [states] or
// [countries], so this is the whole of the admin-side fix.
@Component({
    selector: 'app-address-field',
    templateUrl: './address-field.component.html',
    styleUrls: ['./address-field.component.scss'],
    standalone: false
})
export class AddressFieldComponent {
  @Input() group: FormGroup;
  @Input() states: CodedOption[] = EnumHelper.getState2LetterTypesAsArray()
    .map(([code, name]: [string, string]) => ({ code, name }));
  @Input() countries: CodedOption[] = EnumHelper.getCountry2LetterTypesAsArray()
    .map(([code, name]: [string, string]) => ({ code, name }));
  @Input() showCountry = false;

  private cachedFor: string | null = null;
  private cachedOptions: CodedOption[] = [];
  private cachedCountryFor: string | null = null;
  private cachedCountryOptions: CodedOption[] = [];

  /**
   * The options to offer, always including whatever the record already
   * holds.
   *
   * A `mat-select` whose value matches no option renders BLANK, and the next
   * save writes that blank back - so a record holding anything this list
   * does not know (a pre-migration "Georgia", an APO code, a Canadian
   * province someone typed) would lose its state just by being opened. That
   * is a silent data loss on a screen nobody was editing the address on.
   * Carrying the stored value as its own option shows it as-is and saves it
   * unchanged.
   *
   * Memoised on the current value because a getter that rebuilt the array
   * every change-detection pass would hand `@for` a new object each time.
   */
  get stateOptions(): CodedOption[] {
    const current = this.group?.get('state')?.value;
    const key = typeof current === 'string' ? current : '';
    if (this.cachedFor === key) {
      return this.cachedOptions;
    }
    this.cachedFor = key;
    this.cachedOptions = key && !this.states.some((s) => s.code === key) ?
      [{ code: key, name: key }, ...this.states] :
      this.states;
    return this.cachedOptions;
  }

  /** Same contract as stateOptions, for the opt-in country picker. A record
   *  holding an unrecognised country keeps it rather than being blanked. */
  get countryOptions(): CodedOption[] {
    const current = this.group?.get('country')?.value;
    const key = typeof current === 'string' ? current : '';
    if (this.cachedCountryFor === key) {
      return this.cachedCountryOptions;
    }
    this.cachedCountryFor = key;
    this.cachedCountryOptions = key && !this.countries.some((c) => c.code === key) ?
      [{ code: key, name: key }, ...this.countries] :
      this.countries;
    return this.cachedCountryOptions;
  }
}
