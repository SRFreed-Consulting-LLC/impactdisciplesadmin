import { NgModule } from "@angular/core";
import { IndicatorButtonComponent } from "./indicator-button/indicator-button.component";
import { DxButtonModule, DxFormModule, DxLoadIndicatorModule, DxPopupModule } from "devextreme-angular";
import { CommonModule } from "@angular/common";
import { LocationModalComponent } from './location-modal/location-modal.component';
import { OrganizationModalComponent } from "./organization-modal/organization-modal.component";

@NgModule({
  declarations: [IndicatorButtonComponent, LocationModalComponent, OrganizationModalComponent],
  imports: [
    CommonModule,
    DxButtonModule,
    DxLoadIndicatorModule,
    DxPopupModule,
    DxFormModule
  ],
  exports: [IndicatorButtonComponent, LocationModalComponent, OrganizationModalComponent]
})
export class SharedModule {}
