import { PHONE_TYPES } from "src/app/common/lists/phone_types.enum";

export class Phone {
    countryCode: string;
    number: string;
    extension: string;
    type: PHONE_TYPES;

    constructor(){}
}
