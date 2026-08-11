import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LunchAndLearnsComponent } from './lunch-and-learns-requests/lunch-and-learns.component';
import { LunchAndLearnDialogComponent } from './lunch-and-learns-requests/lunch-and-learn-dialog.component';
import { SeminarsComponent } from './seminars-requests/seminars.component';
import { SeminarDialogComponent } from './seminars-requests/seminar-dialog.component';
import { PhoneNumberMaskPipe } from 'src/app/common/pipes/phone-number.pipe';
import { ImpactDisciplesCommonModule } from 'src/app/common/impactdisciples.common.module';
import { ConsultationsRequestsComponent } from './consultations-requests/consultations-requests.component';
import { ConsultationsSurveysComponent } from './consultations-surveys/consultations-surveys.component';
import { ConsultationSurveyDialogComponent } from './consultations-surveys/consultation-survey-dialog.component';
import { RequestsManagerComponent } from './requests-manager.component';
import { SharedModule } from '../shared/shared.module';
import { RequestsManagerRoutingModule } from './requests-manager-routing.module';
import { ConsultationRequestDialogComponent } from './consultations-requests/consultation-request-dialog.component';
import { CustomFormSubmissionsComponent } from './custom-form-submissions/custom-form-submissions.component';
import { CustomFormSubmissionDetailDialogComponent } from './custom-form-submissions/custom-form-submission-detail-dialog.component';
import { ReactiveFormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatRadioModule } from '@angular/material/radio';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';


@NgModule({
  imports: [
    CommonModule,
    RequestsManagerRoutingModule,
    ImpactDisciplesCommonModule,
    SharedModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatSelectModule,
    MatRadioModule,
    MatSlideToggleModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatAutocompleteModule,
    MatMenuModule,
    MatCheckboxModule
  ],
  declarations: [
    RequestsManagerComponent,
    ConsultationsRequestsComponent,
    ConsultationRequestDialogComponent,
    ConsultationsSurveysComponent,
    ConsultationSurveyDialogComponent,
    LunchAndLearnsComponent,
    LunchAndLearnDialogComponent,
    SeminarsComponent,
    SeminarDialogComponent,
    CustomFormSubmissionsComponent,
    CustomFormSubmissionDetailDialogComponent
  ],
  providers:[
    PhoneNumberMaskPipe
  ]
})
export class RequestsManagerModule { }
