import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DxAutocompleteModule, DxButtonModule, DxContextMenuModule, DxDataGridModule, DxFileUploaderModule, DxFormModule, DxHtmlEditorModule, DxLoadIndicatorModule,
  DxLookupModule, DxPopupModule, DxScrollViewModule, DxSelectBoxModule, DxSwitchModule, DxTabsModule, DxTextBoxModule, DxToolbarModule} from 'devextreme-angular';
import { LunchAndLearnsComponent } from './lunch-and-learns-requests/lunch-and-learns.component';
import { SeminarsComponent } from './seminars-requests/seminars.component';
import { PhoneNumberMaskPipe } from 'impactdisciplescommon/src/pipes/phone-number.pipe';
import { ImpactDisciplesCommonModule } from 'impactdisciplescommon/src/impactdisciples.common.module';
import { ConsultationsRequestsComponent } from './consultations-requests/consultations-requests.component';
import { ConsultationsSurveysComponent } from './consultations-surveys/consultations-surveys.component';
import { RequestsManagerComponent } from './requests-manager.component';
import { SharedModule } from '../shared/shared.module';
import { ImageUploaderModule } from 'impactdisciplescommon/src/forms/image-uploader/image-uploader.module';
import { RequestsManagerRoutingModule } from './requests-manager-routing.module';
import { ConsultationRequestDialogComponent } from './consultations-requests/consultation-request-dialog.component';
import { ReactiveFormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';


@NgModule({
  imports: [
    CommonModule,
    RequestsManagerRoutingModule,
    ImageUploaderModule,
    DxAutocompleteModule,
    DxContextMenuModule,
    DxDataGridModule,
    DxButtonModule,
    DxFormModule,
    DxFileUploaderModule,
    DxHtmlEditorModule,
    DxLookupModule,
    DxLoadIndicatorModule,
    DxPopupModule,
    DxScrollViewModule,
    DxSelectBoxModule,
    DxSwitchModule,
    DxTabsModule,
    DxTextBoxModule,
    DxToolbarModule,
    ImpactDisciplesCommonModule,
    SharedModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule
  ],
  declarations: [
    RequestsManagerComponent,
    ConsultationsRequestsComponent,
    ConsultationRequestDialogComponent,
    ConsultationsSurveysComponent,
    LunchAndLearnsComponent,
    SeminarsComponent,
  ],
  providers:[
    PhoneNumberMaskPipe
  ]
})
export class RequestsManagerModule { }
