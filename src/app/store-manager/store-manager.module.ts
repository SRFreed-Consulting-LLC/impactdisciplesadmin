import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StoreManagerComponent } from './store-manager.component';
import { DxButtonModule, DxCheckBoxModule, DxContextMenuModule, DxDataGridModule, DxFormModule, DxListModule, DxLoadIndicatorModule, DxLoadPanelModule, DxLookupModule, DxNumberBoxModule, DxPopupModule, DxSelectBoxModule, DxSwitchModule, DxTabsModule, DxTagBoxModule, DxTextBoxModule, DxToolbarModule } from 'devextreme-angular';
import { ProductsComponent } from './products/products.component';
import { PurchasesComponent } from './purchases/purchases.component';
import { SharedModule } from '../shared/shared.module';
import { ProductCategoriesComponent } from './product-categories/product-categories.component';
import { CategoryModalComponent } from './product-categories/category-modal/category-modal.component';
import { ProductSeriesComponent } from './product-series/product-series.component';
import { SeriesModalComponent } from './product-series/series-modal/series-modal.component';
import { CouponsComponent } from './coupons/coupons.component';
import { AffiliateSalesComponent } from './affiliate-sales/affiliate-sales.component';
import { AffilliattePaymentsComponent } from './affilliatte-payments/affilliatte-payments.component';
import { SalesComponent } from './sales/sales.component';
import { PurchaseDetailsComponent } from './purchase-details/purchase-details.component';
// This app's own Material file browser, replacing the DevExtreme
// dx-file-manager-backed app-image-uploader from impactdisciplescommon -
// see src/app/shared/image-uploader/ for the full rationale (built during
// the Web Manager migration). Products/Series are the last store-manager
// screens still using it as of this migration pass.
import { ImageUploaderModule } from '../shared/image-uploader/image-uploader.module';
import { StoreManagerRoutingModule } from './store-manager-routing.module';
import { SaleDialogComponent } from './sales/sale-dialog.component';
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
import { QuillModule } from 'ngx-quill';

@NgModule({
  declarations: [
    StoreManagerComponent,
    ProductsComponent,
    PurchasesComponent,
    PurchaseDetailsComponent,
    CouponsComponent,
    AffiliateSalesComponent,
    AffilliattePaymentsComponent,
    ProductCategoriesComponent,
    CategoryModalComponent,
    ProductSeriesComponent,
    SeriesModalComponent,
    SalesComponent,
    SaleDialogComponent
  ],
  imports: [
    CommonModule,
    StoreManagerRoutingModule,
    ImageUploaderModule,
    // Still needed by Coupons/Purchases/Purchase Details/Affiliate Sales,
    // not yet migrated in this pass - DxHtmlEditorModule and
    // DxDropDownBoxModule were only ever used by Products, now removed.
    DxButtonModule,
    DxCheckBoxModule,
    DxDataGridModule,
    DxFormModule,
    DxListModule,
    DxLoadPanelModule,
    DxLookupModule,
    DxNumberBoxModule,
    DxPopupModule,
    DxSelectBoxModule,
    DxSwitchModule,
    DxTabsModule,
    DxTagBoxModule,
    DxTextBoxModule,
    DxToolbarModule,
    DxContextMenuModule,
    SharedModule,
    DxLoadIndicatorModule,
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
    QuillModule
  ]
})
export class StoreManagerModule { }
