import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImpactDisciplesCommonModule } from 'src/app/common/impactdisciples.common.module';
import { DMMServiceComponent } from './dmms/dmms.component';
import { DMMDialogComponent } from './dmms/dmm-dialog.component';
import { TestimonialsComponent } from './testimonials/testimonials.component';
import { PageManagerComponent } from './page-manager.component';
import { SharedModule } from '../shared/shared.module';
import { provideHttpClient } from '@angular/common/http';
// The Home SCREEN (the section stack); HomePageImagesComponent is the slider
// SECTION inside it - see home.component.ts.
import { HomeComponent } from './home/home.component';
import { HomeSectionDialogComponent } from './home/home-section-dialog.component';
import { HomeSlidesDialogComponent } from './home/home-slides-dialog.component';
// EVERY public page is one screen: an ordered stack of sections, a pop-up
// editor per section, and a preview of the whole page. Which sections a page
// can have is declared in pages/page-section-catalogue.ts, so adding a page
// needs no change here. Replaced the slot editor and the three About Us-only
// components on 2026-08-29.
import { PageStackComponent } from './pages/page-stack.component';
import { PageSectionEditorComponent } from './pages/page-section-editor.component';
import { PageLivePreviewComponent } from './pages/page-live-preview.component';
import { CoachingPageComponent } from './coaching-page/coaching-page.component';
import { HomePageImagesComponent } from './home-page-images/home-page-images.component';
import { HomePageImageDialogComponent } from './home-page-images/home-page-image-dialog.component';
import { TeamPageComponent } from './team-page/team-page.component';
import { TeamPageDialogComponent } from './team-page/team-page-dialog.component';
// Moved here from Tools Manager 2026-08-19 with the Web Manager -> Content
// Manager rename - public-site configuration lives with public-site content.
import { WebConfigComponent } from './web-config/web-config.component';
import { DockingBarComponent } from './docking-bar/docking-bar.component';
// This app's own Material file browser, replacing the DevExtreme
// dx-file-manager-backed app-image-uploader from impactdisciplescommon -
// see src/app/shared/image-uploader/ for the full rationale. Web Manager
// is now fully DevExtreme-free.
import { ImageUploaderModule } from '../shared/image-uploader/image-uploader.module';
import { PageManagerRoutingModule } from './page-manager-routing.module';
import { TestimonialDialogComponent } from './testimonials/testimonial-dialog.component';
// FormsModule for the Coaching screen's [(ngModel)] fields - the rest of this
// module is reactive forms, so it was not needed until 2026-08-29.
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
// The Coaching screen and the Home slider list both reorder by dragging.
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
import { MatTabsModule } from '@angular/material/tabs';
import { QuillModule } from 'ngx-quill';

@NgModule({
  imports: [
    CommonModule,
    PageManagerRoutingModule,
    ImpactDisciplesCommonModule,
    SharedModule,
    ImageUploaderModule,
    FormsModule,
    ReactiveFormsModule,
    DragDropModule,
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
    PageManagerComponent,
    DMMServiceComponent,
    DMMDialogComponent,
    TestimonialsComponent,
    TestimonialDialogComponent,
    CoachingPageComponent,
    HomeComponent,
    HomeSectionDialogComponent,
    HomeSlidesDialogComponent,
    PageStackComponent,
    PageSectionEditorComponent,
    PageLivePreviewComponent,
    HomePageImagesComponent,
    HomePageImageDialogComponent,
    TeamPageComponent,
    TeamPageDialogComponent,
    WebConfigComponent,
    DockingBarComponent
  ],
  providers:[
    provideHttpClient()
  ]
})
export class PageManagerModule { }
