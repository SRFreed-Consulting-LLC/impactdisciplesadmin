import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StoreManagerComponent } from './store-manager.component';
import { DxButtonModule, DxDataGridModule, DxFormModule, DxHtmlEditorModule, DxListModule, DxPopupModule, DxSelectBoxModule, DxTabsModule, DxTagBoxModule, DxTextBoxModule, DxToolbarModule } from 'devextreme-angular';
import { ProductsComponent } from './products/products.component';
import { SalesComponent } from './sales/sales.component';
import { SharedModule } from '../shared/shared.module';
import { ImpactFormsModule } from 'impactdisciplescommon/src/forms/forms.module';
import { SeriesComponent } from './series/series.component';

@NgModule({
  declarations: [
    StoreManagerComponent,
    ProductsComponent,
    SalesComponent,
    SeriesComponent
  ],
  imports: [
    CommonModule,
    ImpactFormsModule,
    DxButtonModule,
    DxDataGridModule,
    DxFormModule,
    DxHtmlEditorModule,
    DxListModule,
    DxPopupModule,
    DxSelectBoxModule,
    DxTabsModule,
    DxTagBoxModule,
    DxTextBoxModule,
    DxToolbarModule,
    SharedModule
  ]
})
export class StoreManagerModule { }