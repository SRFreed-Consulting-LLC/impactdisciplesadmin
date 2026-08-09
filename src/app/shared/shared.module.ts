import { NgModule } from "@angular/core";
import { IndicatorButtonComponent } from "./indicator-button/indicator-button.component";
import { CommonModule } from "@angular/common";
import { ConfirmDialogComponent } from './confirm-dialog/confirm-dialog.component';
import { ListHeaderComponent } from './list-header/list-header.component';
import { PopupHeaderComponent } from './popup-header/popup-header.component';
import { ColumnFilterComponent } from './column-filter/column-filter.component';
import { PhoneFieldComponent } from './phone-field/phone-field.component';
import { PhoneMaskDirective } from './phone-field/phone-mask.directive';
import { AddressFieldComponent } from './address-field/address-field.component';
import { VariableInserterComponent } from './rich-text-editor/variable-inserter.component';
import { TableLoadingOverlayComponent } from './table-loading-overlay/table-loading-overlay.component';
import { TagChipsComponent } from './tag-chips/tag-chips.component';
import { InfiniteScrollDirective } from './infinite-scroll.directive';
import { PagedTableFooterComponent } from './paged-table-footer/paged-table-footer.component';
import { NewRecordAlertsComponent } from './new-record-alerts/new-record-alerts.component';
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
import { MatChipsModule } from '@angular/material/chips';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatBadgeModule } from '@angular/material/badge';

@NgModule({
  declarations: [
    IndicatorButtonComponent,
    ConfirmDialogComponent,
    ListHeaderComponent,
    PopupHeaderComponent,
    ColumnFilterComponent,
    PhoneFieldComponent,
    PhoneMaskDirective,
    AddressFieldComponent,
    VariableInserterComponent,
    TableLoadingOverlayComponent,
    TagChipsComponent,
    InfiniteScrollDirective,
    PagedTableFooterComponent,
    NewRecordAlertsComponent
  ],
  imports: [
    CommonModule,
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
    MatSelectModule,
    MatChipsModule,
    MatAutocompleteModule,
    MatBadgeModule
  ],
  exports: [
    IndicatorButtonComponent,
    ConfirmDialogComponent,
    ListHeaderComponent,
    PopupHeaderComponent,
    ColumnFilterComponent,
    PhoneFieldComponent,
    PhoneMaskDirective,
    AddressFieldComponent,
    VariableInserterComponent,
    TableLoadingOverlayComponent,
    TagChipsComponent,
    InfiniteScrollDirective,
    PagedTableFooterComponent,
    NewRecordAlertsComponent
  ]
})
export class SharedModule {}
