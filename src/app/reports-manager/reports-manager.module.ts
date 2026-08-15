import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialogModule } from '@angular/material/dialog';
import { QuillModule } from 'ngx-quill';
import { SharedModule } from '../shared/shared.module';
import { ReportsManagerRoutingModule } from './reports-manager-routing.module';
import { ReportsManagerComponent } from './reports-manager.component';
import { PurchaseReportComponent } from './purchase-report/purchase-report.component';
import { SubscriberReportComponent } from './subscriber-report/subscriber-report.component';
import { SubscriberDialogComponent } from './subscriber-report/subscriber-dialog.component';
import { SendSubscriptionDialogComponent } from './subscriber-report/send-subscription-dialog.component';
import { CustomerReportComponent } from './customer-report/customer-report.component';
import { EventReportComponent } from './event-report/event-report.component';

@NgModule({
  declarations: [
    ReportsManagerComponent,
    PurchaseReportComponent,
    SubscriberReportComponent,
    SubscriberDialogComponent,
    SendSubscriptionDialogComponent,
    CustomerReportComponent,
    EventReportComponent
  ],
  imports: [
    CommonModule,
    ReportsManagerRoutingModule,
    SharedModule,
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSlideToggleModule,
    MatTableModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    QuillModule
  ]
})
export class ReportsManagerModule { }
