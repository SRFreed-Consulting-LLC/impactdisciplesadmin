import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LogMessagesComponent } from './log-messages/log-messages.component';
import { UsersComponent } from './users/users.component';
import { NotificationsComponent } from './notifications/notifications.component';
import { WebConfigComponent } from './web-config/web-config.component';
import { PhoneNumberMaskPipe } from 'impactdisciplescommon/src/pipes/phone-number.pipe';
import { ImpactDisciplesCommonModule } from 'impactdisciplescommon/src/impactdisciples.common.module';
import { AdminManagerComponent } from './admin-manager.component';
import { SharedModule } from '../shared/shared.module';
import { EmailTemplatesComponent } from './email-templates/email-templates.component';
import { CustomersComponent } from './customers/customers.component';
import { ShippingLabelsComponent } from './shipping-labels/shipping-labels.component';
import { ShippingBatchDialogComponent } from './shipping-labels/shipping-batch-dialog.component';
import { ShippingLabelDialogComponent } from './shipping-labels/shipping-label-dialog.component';
import { FromAddressDialogComponent } from './shipping-labels/from-address-dialog.component';
import { ShippingResultsDialogComponent } from './shipping-labels/shipping-results-dialog.component';
import { AdminManagerRoutingModule } from './admin-manager-routing.module';
import { NotificationDialogComponent } from './notifications/notification-dialog.component';
import { UserDialogComponent } from './users/user-dialog.component';
import { EmailTemplateDialogComponent } from './email-templates/email-template-dialog.component';
import { CustomerDialogComponent } from './customers/customer-dialog.component';
import { SendEmailDialogComponent } from './customers/send-email-dialog.component';
import { EmailListDialogComponent } from './customers/email-list-dialog.component';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { QuillModule } from 'ngx-quill';


@NgModule({
  imports: [
    CommonModule,
    AdminManagerRoutingModule,
    ImpactDisciplesCommonModule,
    SharedModule,
    FormsModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatSelectModule,
    MatTabsModule,
    MatProgressSpinnerModule,
    MatCheckboxModule,
    MatMenuModule,
    MatDividerModule,
    QuillModule
  ],
  declarations: [
    AdminManagerComponent,
    LogMessagesComponent,
    NotificationsComponent,
    NotificationDialogComponent,
    UsersComponent,
    UserDialogComponent,
    CustomersComponent,
    CustomerDialogComponent,
    SendEmailDialogComponent,
    EmailListDialogComponent,
    WebConfigComponent,
    EmailTemplatesComponent,
    EmailTemplateDialogComponent,
    ShippingLabelsComponent,
    ShippingBatchDialogComponent,
    ShippingLabelDialogComponent,
    FromAddressDialogComponent,
    ShippingResultsDialogComponent
  ],
  providers:[
    PhoneNumberMaskPipe
  ]
})
export class AdminManagerModule { }
