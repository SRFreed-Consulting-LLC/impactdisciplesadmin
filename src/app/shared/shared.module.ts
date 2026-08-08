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
import { PhoneFieldComponent } from './phone-field/phone-field.component';
import { PhoneMaskDirective } from './phone-field/phone-mask.directive';
import { AddressFieldComponent } from './address-field/address-field.component';
import { VariableInserterComponent } from './rich-text-editor/variable-inserter.component';
import { SectionTabsComponent } from './section-tabs/section-tabs.component';
import { TableLoadingOverlayComponent } from './table-loading-overlay/table-loading-overlay.component';
import { ReactiveFormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatMenuModule } from '@angular/material/menu';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';

@NgModule({
  declarations: [
    IndicatorButtonComponent,
    LocationModalComponent,
    OrganizationModalComponent,
    ConfirmDialogComponent,
    ListHeaderComponent,
    PopupHeaderComponent,
    ColumnFilterComponent,
    PhoneFieldComponent,
    PhoneMaskDirective,
    AddressFieldComponent,
    VariableInserterComponent,
    SectionTabsComponent,
    TableLoadingOverlayComponent
  ],
  imports: [
    CommonModule,
    DxButtonModule,
    DxLoadIndicatorModule,
    DxPopupModule,
    DxFormModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatToolbarModule,
    MatMenuModule,
    MatIconModule,
    MatDividerModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule
  ],
  exports: [
    IndicatorButtonComponent,
    LocationModalComponent,
    OrganizationModalComponent,
    ConfirmDialogComponent,
    ListHeaderComponent,
    PopupHeaderComponent,
    ColumnFilterComponent,
    PhoneFieldComponent,
    PhoneMaskDirective,
    AddressFieldComponent,
    VariableInserterComponent,
    SectionTabsComponent,
    TableLoadingOverlayComponent
  ]
})
export class SharedModule {}
