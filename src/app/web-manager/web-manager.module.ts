import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PhoneNumberMaskPipe } from 'impactdisciplescommon/src/pipes/phone-number.pipe';
import { ImpactDisciplesCommonModule } from 'impactdisciplescommon/src/impactdisciples.common.module';
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
// app-image-uploader is the one remaining DevExtreme dependency in this
// module - it wraps dx-file-manager (a full file browser: folders, chunked
// upload, rename/move/copy/delete) with no Material equivalent. Left as-is
// for now per plan; everything else in this module is Material-only.
import { ImageUploaderModule } from 'impactdisciplescommon/src/forms/image-uploader/image-uploader.module';
import { HomePagePopupsComponent } from './home-page-popups/home-page-popups.component';
import { HomePagePopupPreviewDialogComponent } from './home-page-popups/home-page-popup-preview-dialog.component';
import { WebManagerRoutingModule } from './web-manager-routing.module';
import { PodCastCategoryDialogComponent } from './pod-cast-categories/pod-cast-category-dialog.component';
import { TestimonialDialogComponent } from './testimonials/testimonial-dialog.component';
import { MonthlyNewsletterDialogComponent } from './monthly-newsletters/monthly-newsletter-dialog.component';
import { ReactiveFormsModule } from '@angular/forms';
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
    QuillModule
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
    MonthlyNewsletterDialogComponent
  ],
  providers:[
    PhoneNumberMaskPipe,
    provideHttpClient()
  ]
})
export class WebManagerModule { }
