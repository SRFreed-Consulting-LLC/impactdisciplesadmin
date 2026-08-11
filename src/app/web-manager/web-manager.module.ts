import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PhoneNumberMaskPipe } from 'src/app/common/pipes/phone-number.pipe';
import { ImpactDisciplesCommonModule } from 'src/app/common/impactdisciples.common.module';
import { DMMServiceComponent } from './dmms/dmms.component';
import { DMMDialogComponent } from './dmms/dmm-dialog.component';
import { PodCastsComponent } from './pod-casts/pod-casts.component';
import { PodCastDialogComponent } from './pod-casts/pod-cast-dialog.component';
import { TestimonialsComponent } from './testimonials/testimonials.component';
import { WebManagerComponent } from './web-manager.component';
import { SharedModule } from '../shared/shared.module';
import { PodCastCategoriesComponent } from './pod-cast-categories/pod-cast-categories.component';
import { provideHttpClient } from '@angular/common/http';
import { HomePageImagesComponent } from './home-page-images/home-page-images.component';
import { HomePageImageDialogComponent } from './home-page-images/home-page-image-dialog.component';
import { MonthlyNewslettersComponent } from './monthly-newsletters/monthly-newsletters.component';
// This app's own Material file browser, replacing the DevExtreme
// dx-file-manager-backed app-image-uploader from impactdisciplescommon -
// see src/app/shared/image-uploader/ for the full rationale. Web Manager
// is now fully DevExtreme-free.
import { ImageUploaderModule } from '../shared/image-uploader/image-uploader.module';
import { HomePagePopupsComponent } from './home-page-popups/home-page-popups.component';
import { HomePagePopupPreviewDialogComponent } from './home-page-popups/home-page-popup-preview-dialog.component';
import { WebManagerRoutingModule } from './web-manager-routing.module';
import { PodCastCategoryDialogComponent } from './pod-cast-categories/pod-cast-category-dialog.component';
import { TestimonialDialogComponent } from './testimonials/testimonial-dialog.component';
import { MonthlyNewsletterDialogComponent } from './monthly-newsletters/monthly-newsletter-dialog.component';
import { FormBuilderComponent } from './form-builder/form-builder.component';
import { FormFieldSettingsComponent } from './form-builder/form-field-settings.component';
import { FormTestSubmitDialogComponent } from './form-builder/form-test-submit-dialog.component';
import { ReactiveFormsModule } from '@angular/forms';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { QuillModule } from 'ngx-quill';

@NgModule({
  imports: [
    CommonModule,
    WebManagerRoutingModule,
    ImpactDisciplesCommonModule,
    SharedModule,
    ImageUploaderModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatSlideToggleModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatToolbarModule,
    MatProgressSpinnerModule,
    MatMenuModule,
    MatCheckboxModule,
    MatButtonToggleModule,
    QuillModule,
    DragDropModule
  ],
  declarations: [
    WebManagerComponent,
    DMMServiceComponent,
    DMMDialogComponent,
    PodCastsComponent,
    PodCastDialogComponent,
    TestimonialsComponent,
    TestimonialDialogComponent,
    PodCastCategoriesComponent,
    PodCastCategoryDialogComponent,
    HomePageImagesComponent,
    HomePageImageDialogComponent,
    HomePagePopupsComponent,
    HomePagePopupPreviewDialogComponent,
    MonthlyNewslettersComponent,
    MonthlyNewsletterDialogComponent,
    FormBuilderComponent,
    FormFieldSettingsComponent,
    FormTestSubmitDialogComponent
  ],
  providers:[
    PhoneNumberMaskPipe,
    provideHttpClient()
  ]
})
export class WebManagerModule { }
