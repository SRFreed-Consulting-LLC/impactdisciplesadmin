import { NgModule } from "@angular/core";
import { IndicatorButtonComponent } from "./indicator-button/indicator-button.component";
import { DxButtonModule, DxFormModule, DxLoadIndicatorModule, DxPopupModule } from "devextreme-angular";
import { CommonModule } from "@angular/common";
import { LocationModalComponent } from './location-modal/location-modal.component';
import { OrganizationModalComponent } from "./organization-modal/organization-modal.component";
import { ConfirmDialogComponent } from './confirm-dialog/confirm-dialog.component';
import { ListHeaderComponent } from './list-header/list-header.component';
import { PopupHeaderComponent } from './popup-header/popup-header.component';
import { ColumnFilterComponent } from './column-filter/column-filter.component';
import { MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';

@NgModule({
  declarations: [
    IndicatorButtonComponent,
    LocationModalComponent,
    OrganizationModalComponent,
    ConfirmDialogComponent,
    ListHeaderComponent,
    PopupHeaderComponent,
    ColumnFilterComponent
  ],
  imports: [
    CommonModule,
    DxButtonModule,
    DxLoadIndicatorModule,
    DxPopupModule,
    DxFormModule,
    MatDialogModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatToolbarModule,
    MatMenuModule,
    MatIconModule,
    MatDividerModule
  ],
  exports: [
    IndicatorButtonComponent,
    LocationModalComponent,
    OrganizationModalComponent,
    ConfirmDialogComponent,
    ListHeaderComponent,
    PopupHeaderComponent,
    ColumnFilterComponent
  ]
})
export class SharedModule {}
