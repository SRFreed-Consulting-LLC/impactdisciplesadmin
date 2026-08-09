import { NgModule } from '@angular/core';
import { PipesModule } from './pipes/pipes.module';
import { PhoneNumberMaskPipe } from './pipes/phone-number.pipe';

@NgModule({
  declarations: [
  ],
  imports: [
    PipesModule
  ],
  providers: [
  ],
  exports: [
    PhoneNumberMaskPipe
  ]
})
export class ImpactDisciplesCommonModule { }
