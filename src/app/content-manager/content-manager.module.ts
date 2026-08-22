import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PhoneNumberMaskPipe } from 'src/app/common/pipes/phone-number.pipe';
import { ImpactDisciplesCommonModule } from 'src/app/common/impactdisciples.common.module';
import { DMMServiceComponent } from './dmms/dmms.component';
import { DMMDialogComponent } from './dmms/dmm-dialog.component';
import { TestimonialsComponent } from './testimonials/testimonials.component';
import { ContentManagerComponent } from './content-manager.component';
import { SharedModule } from '../shared/shared.module';
import { provideHttpClient } from '@angular/common/http';
import { HomePageImagesComponent } from './home-page-images/home-page-images.component';
import { HomePageImageDialogComponent } from './home-page-images/home-page-image-dialog.component';
import { TeamPageComponent } from './team-page/team-page.component';
import { TeamPageDialogComponent } from './team-page/team-page-dialog.component';
// Moved here from Tools Manager 2026-08-19 with the Web Manager -> Content
// Manager rename - public-site configuration lives with public-site content.
import { WebConfigComponent } from './web-config/web-config.component';
// This app's own Material file browser, replacing the DevExtreme
// dx-file-manager-backed app-image-uploader from impactdisciplescommon -
// see src/app/shared/image-uploader/ for the full rationale. Web Manager
// is now fully DevExtreme-free.
import { ImageUploaderModule } from '../shared/image-uploader/image-uploader.module';
import { ContentManagerRoutingModule } from './content-manager-routing.module';
import { TestimonialDialogComponent } from './testimonials/testimonial-dialog.component';
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
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { QuillModule } from 'ngx-quill';

@NgModule({
  imports: [
    CommonModule,
    ContentManagerRoutingModule,
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
    MatTabsModule,
    QuillModule
  ],
  declarations: [
    ContentManagerComponent,
    DMMServiceComponent,
    DMMDialogComponent,
    TestimonialsComponent,
    TestimonialDialogComponent,
    HomePageImagesComponent,
    HomePageImageDialogComponent,
    TeamPageComponent,
    TeamPageDialogComponent,
    WebConfigComponent
  ],
  providers:[
    PhoneNumberMaskPipe,
    provideHttpClient()
  ]
})
export class ContentManagerModule { }
