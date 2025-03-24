import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DxButtonModule, DxContextMenuModule, DxDataGridModule, DxDateBoxModule, DxFileUploaderModule, DxFormModule, DxHtmlEditorModule, DxLoadIndicatorModule, DxLoadPanelModule, DxNumberBoxModule, DxPopupModule,
         DxSelectBoxModule,
         DxSwitchModule, DxTabsModule, DxTagBoxModule, DxTextBoxModule,
         DxToolbarModule} from 'devextreme-angular';
import { ImpactFormsModule } from 'impactdisciplescommon/src/forms/forms.module';
import { PhoneNumberMaskPipe } from 'impactdisciplescommon/src/pipes/phone-number.pipe';
import { ImpactDisciplesModule } from 'impactdisciplescommon/src/impactdisciples.common.module';
import { BlogPostsComponent } from './blog-posts/blog-posts.component';
import { PodCastsComponent } from './pod-casts/pod-casts.component';
import { TestimonialsComponent } from './testimonials/testimonials.component';
import { WebManagerComponent } from './web-manager.component';
import { SharedModule } from '../shared/shared.module';
import { BlogCategoriesComponent } from './blog-categories/blog-categories.component';
import { PodCastCategoriesComponent } from './pod-cast-categories/pod-cast-categories.component';
import { provideHttpClient } from '@angular/common/http';
import { HomePageImagesComponent } from './home-page-images/home-page-images.component';


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
    BlogPostsComponent,
    PodCastsComponent,
    TestimonialsComponent,
    BlogCategoriesComponent,
    PodCastCategoriesComponent,
    HomePageImagesComponent
  ],
  providers:[
    PhoneNumberMaskPipe,
    provideHttpClient()
  ]
})
export class WebManagerModule { }
