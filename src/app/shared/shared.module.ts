import { NgModule } from "@angular/core";
import { IndicatorButtonComponent } from "./indicator-button/indicator-button.component";
import { CommonModule, CurrencyPipe, DatePipe } from "@angular/common";
import { ConfirmDialogComponent } from './confirm-dialog/confirm-dialog.component';
import { ListHeaderComponent } from './list-header/list-header.component';
import { PopupHeaderComponent } from './popup-header/popup-header.component';
import { ColumnFilterComponent } from './data-grid/column-filter/column-filter.component';
import { PhoneFieldComponent } from './phone-field/phone-field.component';
import { PhoneMaskDirective } from './phone-field/phone-mask.directive';
import { AddressFieldComponent } from './address-field/address-field.component';
import { VariableInserterComponent } from './rich-text-editor/variable-inserter.component';
import { TableLoadingOverlayComponent } from './data-grid/table-loading-overlay/table-loading-overlay.component';
import { TagChipsComponent } from './tag-chips/tag-chips.component';
import { InfiniteScrollDirective } from './infinite-scroll.directive';
import { PagedTableFooterComponent } from './data-grid/paged-table-footer/paged-table-footer.component';
import { NewRecordAlertsComponent } from './new-record-alerts/new-record-alerts.component';
import { OrderWorkflowDialogComponent } from './order-workflow-dialog/order-workflow-dialog.component';
import { RouteRequestDialogComponent } from './route-request-dialog/route-request-dialog.component';
import { DataGridComponent } from './data-grid/data-grid.component';
import { DataGridCellDirective } from './data-grid/data-grid-cell.directive';
import { FormRendererComponent } from './form-renderer/form-renderer.component';
import { FormRendererFieldComponent } from './form-renderer/form-renderer-field.component';
import { DateTimeFieldComponent } from './date-time-field/date-time-field.component';
import { AmazonConfirmationDialogComponent } from './amazon-confirmation-dialog/amazon-confirmation-dialog.component';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
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
import { MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatTimepickerModule } from '@angular/material/timepicker';
import { MatNativeDateModule } from '@angular/material/core';

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
    NewRecordAlertsComponent,
    OrderWorkflowDialogComponent,
    RouteRequestDialogComponent,
    DataGridComponent,
    DataGridCellDirective,
    FormRendererComponent,
    FormRendererFieldComponent,
    DateTimeFieldComponent,
    AmazonConfirmationDialogComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
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
    MatBadgeModule,
    MatTableModule,
    MatCheckboxModule,
    MatRadioModule,
    MatDatepickerModule,
    MatTimepickerModule,
    MatNativeDateModule
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
    NewRecordAlertsComponent,
    OrderWorkflowDialogComponent,
    RouteRequestDialogComponent,
    DataGridComponent,
    DataGridCellDirective,
    FormRendererComponent,
    FormRendererFieldComponent,
    DateTimeFieldComponent,
    AmazonConfirmationDialogComponent
  ],
  // DatePipe/CurrencyPipe aren't auto-registered for DI just by importing
  // CommonModule (that only makes the `| date`/`| currency` template pipes
  // usable) - DataGridComponent injects them directly to format date/
  // currency-type columns in TS (see its own comment on why), which needs
  // this explicit provider.
  providers: [DatePipe, CurrencyPipe]
})
export class SharedModule {}
