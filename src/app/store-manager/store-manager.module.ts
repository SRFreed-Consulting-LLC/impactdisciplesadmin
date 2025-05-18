import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StoreManagerComponent } from './store-manager.component';
import { DxButtonModule, DxCheckBoxModule, DxContextMenuModule, DxDataGridModule, DxDropDownBoxModule, DxFormModule, DxHtmlEditorModule, DxListModule, DxLoadIndicatorModule, DxLoadPanelModule, DxLookupModule, DxNumberBoxModule, DxPopupModule, DxSelectBoxModule, DxSwitchModule, DxTabsModule, DxTagBoxModule, DxTextBoxModule, DxToolbarModule } from 'devextreme-angular';
import { ProductsComponent } from './products/products.component';
import { PurchasesComponent } from './purchases/purchases.component';
import { SharedModule } from '../shared/shared.module';
import { ImpactFormsModule } from 'impactdisciplescommon/src/forms/forms.module';
import { ProductCategoriesComponent } from './product-categories/product-categories.component';
import { CategoryModalComponent } from './product-categories/category-modal/category-modal.component';
import { ProductSeriesComponent } from './product-series/product-series.component';
import { SeriesModalComponent } from './product-series/series-modal/series-modal.component';
import { CouponsComponent } from './coupons/coupons.component';
import { AffiliateSalesComponent } from './affiliate-sales/affiliate-sales.component';
import { AffilliattePaymentsComponent } from './affilliatte-payments/affilliatte-payments.component';
import { SalesComponent } from './sales/sales.component';

@NgModule({
  declarations: [
    StoreManagerComponent,
    ProductsComponent,
    PurchasesComponent,
    CouponsComponent,
    AffiliateSalesComponent,
    AffilliattePaymentsComponent,
    ProductCategoriesComponent,
    CategoryModalComponent,
    ProductSeriesComponent,
    SeriesModalComponent,
    SalesComponent
  ],
  imports: [
    CommonModule,
    ImpactFormsModule,
    DxButtonModule,
    DxCheckBoxModule,
    DxDataGridModule,
    DxFormModule,
    DxHtmlEditorModule,
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
    DxDropDownBoxModule,
    DxContextMenuModule,
    SharedModule,
    DxLoadIndicatorModule
  ]
})
export class StoreManagerModule { }
