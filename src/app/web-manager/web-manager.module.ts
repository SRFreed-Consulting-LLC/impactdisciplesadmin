import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DxButtonModule, DxContextMenuModule, DxDataGridModule, DxDateBoxModule, DxFileUploaderModule, DxFormModule, DxHtmlEditorModule, DxLoadIndicatorModule, DxLoadPanelModule, DxNumberBoxModule, DxPopupModule,
         DxSelectBoxModule,
         DxSwitchModule, DxTabsModule, DxTagBoxModule, DxTextBoxModule,
         DxToolbarModule} from 'devextreme-angular';
import { ImpactFormsModule } from 'impactdisciplescommon/src/forms/forms.module';
import { PhoneNumberMaskPipe } from 'impactdisciplescommon/src/pipes/phone-number.pipe';
import { ImpactDisciplesModule } from 'impactdisciplescommon/src/impactdisciples.common.module';
import { DMMServiceComponent } from './dmms/dmms.component';
import { PodCastsComponent } from './pod-casts/pod-casts.component';
import { TestimonialsComponent } from './testimonials/testimonials.component';
import { WebManagerComponent } from './web-manager.component';
import { SharedModule } from '../shared/shared.module';
import { PodCastCategoriesComponent } from './pod-cast-categories/pod-cast-categories.component';
import { provideHttpClient } from '@angular/common/http';
import { HomePageImagesComponent } from './home-page-images/home-page-images.component';
import { MonthlyNewslettersComponent } from './monthly-newsletters/monthly-newsletters.component';


@NgModule({
  imports: [
    CommonModule,
    ImpactFormsModule,
    DxDataGridModule,
    DxContextMenuModule,
    DxButtonModule,
    DxDateBoxModule,
    DxFormModule,
    DxFileUploaderModule,
    DxLoadPanelModule,
    DxHtmlEditorModule,
    DxLoadIndicatorModule,
    DxNumberBoxModule,
    DxPopupModule,
    DxSelectBoxModule,
    DxSwitchModule,
    DxTabsModule,
    DxTagBoxModule,
    DxTextBoxModule,
    DxToolbarModule,
    ImpactDisciplesModule,
    SharedModule,

  ],
  declarations: [
    WebManagerComponent,
    DMMServiceComponent,
    PodCastsComponent,
    TestimonialsComponent,
    PodCastCategoriesComponent,
    HomePageImagesComponent,
    MonthlyNewslettersComponent
  ],
  providers:[
    PhoneNumberMaskPipe,
    provideHttpClient()
  ]
})
export class WebManagerModule { }
