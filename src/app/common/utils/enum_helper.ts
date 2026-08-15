import { Countries } from "../lists/countries.enum";
import { PHONE_TYPES } from "../lists/phone_types.enum";
import { States } from "../lists/states.enum";
import { TESTIMONIAL_TYPES } from "../lists/testimonial_types.enum";
import { UNIT_OF_MEASURE } from "../lists/unit_of_measure.enum";

export class EnumHelper {
  static getPhoneTypesAsArray(): PHONE_TYPES[] {
    return Object.keys(PHONE_TYPES).map(key => PHONE_TYPES[key]);
  }

  static getTestimonialTypesAsArray(): TESTIMONIAL_TYPES[] {
    return Object.keys(TESTIMONIAL_TYPES).map(key => TESTIMONIAL_TYPES[key]);
  }

  static getStateTypesAsArray(): string[] {
    return Object.values(States) as [];
  }

  // Unlike the other getters above, these return [key, value] pairs (e.g.
  // ["CA", "California"]) rather than just values - callers need both the
  // 2-letter code (to store) and the full name (to display).
  static getState2LetterTypesAsArray(): [string, string][] {
    return Object.entries(States);
  }

  static getCountryTypesAsArray(): string[] {
    return Object.values(Countries) as [];
  }

  static getCountry2LetterTypesAsArray(): [string, string][] {
    return Object.entries(Countries);
  }

  static getUOMTypesAsArray(): string[] {
    return Object.values(UNIT_OF_MEASURE) as [];
  }
}
