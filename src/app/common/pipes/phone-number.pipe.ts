import { Pipe, PipeTransform } from '@angular/core';
import { Phone } from '../models/domain/utils/phone.model';

@Pipe({
    name: 'phoneNumberMask',
    standalone: false
})
export class PhoneNumberMaskPipe implements PipeTransform {
  transform(phoneNumber: Phone, showExtension: boolean = true): string {
    if (!phoneNumber || !phoneNumber?.number) {
      return '';
    }

    const number = this.matcher(phoneNumber?.number);

    return `${number} ${showExtension && phoneNumber?.extension ? ` (ext. ${phoneNumber?.extension})` : ''}`;
  }

  public matcher = (number) => {
    if (!number) {
      return '';
    }
    const matcher = number.match(/(\d{3})(\d{3})(\d{4})/);
    const maskedNumber = matcher ? `(${matcher[1]}) ${matcher[2]} - ${matcher[3]}` : number;

    return maskedNumber;
  };
}
