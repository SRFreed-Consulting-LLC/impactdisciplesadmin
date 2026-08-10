import { NgModule } from '@angular/core';
import { PhoneNumberMaskPipe } from './phone-number.pipe';

@NgModule({
  declarations: [
    PhoneNumberMaskPipe
  ],
  exports: [
    PhoneNumberMaskPipe
  ]
})
export class PipesModule { }
