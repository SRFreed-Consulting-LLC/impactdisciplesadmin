import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
// routerLink on the Pages list's original-page rows.
import { RouterModule } from '@angular/router';
import { ImpactDisciplesCommonModule } from 'src/app/common/impactdisciples.common.module';
import { DMMServiceComponent } from './dmms/dmms.component';
import { DMMDialogComponent } from './dmms/dmm-dialog.component';
import { PageManagerComponent } from './page-manager.component';
import { SharedModule } from '../shared/shared.module';
import { provideHttpClient } from '@angular/common/http';
// The Home SCREEN (the section stack); HomePageImagesComponent is the slider
// SECTION inside it - see home.component.ts.
import { HomeComponent } from './home/home.component';
import { HomeSectionEditorComponent } from './home/home-section-editor.component';
// EVERY public page is one screen: an ordered stack of sections, a FULL-SCREEN
// editor per section, and the real page in a frame beside it. Which sections a
// page can have is declared in pages/page-section-catalogue.ts, so adding a
// page needs no change here. Replaced the slot editor and the three About
// Us-only components on 2026-08-29; the pop-ups went the same day, along with
// Home's two.
// NavigationComponent is NOT declared here. The public site's top menu became
// a top-level screen on 2026-08-30 and has its own lazy module,
// navigation/navigation.module.ts - its files stay in this folder only
// because it borrows pages/page-stack.component.css outright.
import { PageStackComponent } from './pages/page-stack.component';
import { PageSectionEditorComponent } from './pages/page-section-editor.component';
import { NewPageDialogComponent } from './pages/new-page-dialog.component';
// The per-leaf editor for a created page - the loading shell around the
// same app-page-stack the twelve originals use.
import { KitPageEditorComponent } from './pages/kit-page-editor.component';
// The side-by-side an original page's Compare button opens.
import { KitCompareComponent } from './pages/kit-compare.component';
import { PageLivePreviewModule } from './pages/page-live-preview.module';
import { DestinationFieldComponent } from './pages/destination-field.component';
import { HomePageImagesComponent } from './home-page-images/home-page-images.component';
import { HomePageImageDialogComponent } from './home-page-images/home-page-image-dialog.component';
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
// FormsModule for the section editors' [(ngModel)] fields - the rest of this
// module is reactive forms, so it was not needed until 2026-08-29.
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
// Every section stack, entry list and quote order reorders by dragging.
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
// The Navigation screen's Add menu separates pages from links and dropdowns.
import { MatDividerModule } from '@angular/material/divider';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { QuillModule } from 'ngx-quill';

@NgModule({
  imports: [
    CommonModule,
    RouterModule,
    PageManagerRoutingModule,
    PageLivePreviewModule,
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
    MatDividerModule,
    MatCheckboxModule,
    MatButtonToggleModule,
    MatTabsModule,
    QuillModule
  ],
  declarations: [
    PageManagerComponent,
    DMMServiceComponent,
    DMMDialogComponent,
    HomeComponent,
    HomeSectionEditorComponent,
    PageStackComponent,
    PageSectionEditorComponent,
    NewPageDialogComponent,
    KitPageEditorComponent,
    KitCompareComponent,
    DestinationFieldComponent,
    HomePageImagesComponent,
    HomePageImageDialogComponent,
    WebConfigComponent,
    DockingBarComponent
  ],
  providers:[
    provideHttpClient()
  ]
})
export class PageManagerModule { }
