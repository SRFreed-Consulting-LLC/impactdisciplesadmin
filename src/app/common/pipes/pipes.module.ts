import { NgModule } from '@angular/core';
import { PhoneNumberMaskPipe } from './phone-number.pipe';
import { SafeHtmlPipe } from './safe-html.pipe';

@NgModule({
  declarations: [
    PhoneNumberMaskPipe,
    SafeHtmlPipe
  ],
  exports: [
    PhoneNumberMaskPipe,
    SafeHtmlPipe
  ]
})
export class PipesModule { }
