import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StoreManagerComponent } from './store-manager.component';
import { SharedModule } from '../shared/shared.module';
// Products, and the Categories/Series screens edited inside it, moved to the
// DATA manager on 2026-08-30 - see data-manager.component.ts. Store Manager
// keeps the money screens: coupons, affiliate sales and payments.
import { CouponsComponent } from './coupons/coupons.component';
import { CouponDialogComponent } from './coupons/coupon-dialog.component';
import { AffiliateSalesComponent } from './affiliate-sales/affiliate-sales.component';
// This app's own Material file browser, replacing the DevExtreme
// dx-file-manager-backed app-image-uploader from impactdisciplescommon -
// see src/app/shared/image-uploader/ for the full rationale (built during
// the Web Manager migration). Products/Series are the last store-manager
// screens still using it as of this migration pass.
import { ImageUploaderModule } from '../shared/image-uploader/image-uploader.module';
import { StoreManagerRoutingModule } from './store-manager-routing.module';
import { ReactiveFormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTabsModule } from '@angular/material/tabs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { QuillModule } from 'ngx-quill';

@NgModule({
  declarations: [
    StoreManagerComponent,
    CouponsComponent,
    CouponDialogComponent,
    AffiliateSalesComponent
  ],
  imports: [
    CommonModule,
    StoreManagerRoutingModule,
    ImageUploaderModule,
    SharedModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatSlideToggleModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSelectModule,
    MatCheckboxModule,
    MatTabsModule,
    MatToolbarModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    QuillModule
  ]
})
export class StoreManagerModule { }
