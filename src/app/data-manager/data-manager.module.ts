import { NgModule } from '@angular/core';
// Web Config and the docking bar moved to this module on 2026-08-31.
// Their FILES stay under page-manager/ - the same arrangement
// NavigationModule already has, and for the same reason: the files are
// fine where they are and moving them would make the diff unreadable.
import { WebConfigComponent } from '../page-manager/web-config/web-config.component';
import { CommonModule } from '@angular/common';
import { RouterModule, Routes } from '@angular/router';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatNativeDateModule } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialogModule } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { QuillModule } from 'ngx-quill';

import { SharedModule } from '../shared/shared.module';
import { ImageUploaderModule } from '../shared/image-uploader/image-uploader.module';

import { DataManagerComponent } from './data-manager.component';
import { ProductsComponent } from './products/products.component';
import { ProductCategoriesComponent } from './product-categories/product-categories.component';
import { CategoryModalComponent } from './product-categories/category-modal/category-modal.component';
import { ProductSeriesComponent } from './product-series/product-series.component';
import { SeriesModalComponent } from './product-series/series-modal/series-modal.component';
import { TestimonialsComponent } from './testimonials/testimonials.component';
import { TestimonialDialogComponent } from './testimonials/testimonial-dialog.component';
import { TeamPageComponent } from './team-page/team-page.component';
import { TeamPageDialogComponent } from './team-page/team-page-dialog.component';
import { CustomFormSubmissionsComponent } from './custom-form-submissions/custom-form-submissions.component';
import { CustomFormSubmissionDetailDialogComponent } from './custom-form-submissions/custom-form-submission-detail-dialog.component';
import { FormBuilderComponent } from './form-builder/form-builder.component';
import { FormFieldSettingsComponent } from './form-builder/form-field-settings.component';
import { FormTestSubmitDialogComponent } from './form-builder/form-test-submit-dialog.component';
import { DMMServiceComponent } from './dmms/dmms.component';
import { DMMDialogComponent } from './dmms/dmm-dialog.component';

/**
 * DATA - see data-manager.component.ts for what these five screens have in
 * common and why they were gathered.
 *
 * Product Categories and Product Series came along with Products and are NOT
 * screens of their own: they are edited inside the Products screen and are
 * used by nothing else in the app, so leaving them behind in Store Manager
 * would have split one screen across two lazy modules.
 *
 * The Material imports are the union of what the four modules these came
 * from each provided. Trimming that union to exactly what is used is worth
 * doing, but not in the same change as the move - a missing module here
 * fails as NG8001 "not a known element" on a screen nobody opened, which is
 * the kind of thing that surfaces a week later.
 */
const routes: Routes = [
  { path: '', component: DataManagerComponent }
];

@NgModule({
  declarations: [
    WebConfigComponent,
    DataManagerComponent,
    ProductsComponent,
    ProductCategoriesComponent,
    CategoryModalComponent,
    ProductSeriesComponent,
    SeriesModalComponent,
    TestimonialsComponent,
    TestimonialDialogComponent,
    TeamPageComponent,
    TeamPageDialogComponent,
    DMMServiceComponent,
    DMMDialogComponent,
    CustomFormSubmissionsComponent,
    CustomFormSubmissionDetailDialogComponent,
    FormBuilderComponent,
    FormFieldSettingsComponent,
    FormTestSubmitDialogComponent
  ],
  imports: [
    CommonModule,
    RouterModule.forChild(routes),
    SharedModule,
    ImageUploaderModule,
    FormsModule,
    ReactiveFormsModule,
    DragDropModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatDialogModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTableModule,
    MatTabsModule,
    MatToolbarModule,
    MatTooltipModule,
    QuillModule
  ]
})
export class DataManagerModule { }
