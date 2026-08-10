import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LogMessagesComponent } from './log-messages/log-messages.component';
import { AdminUsersComponent } from './admin-users/admin-users.component';
import { NotificationsComponent } from './notifications/notifications.component';
import { WebConfigComponent } from './web-config/web-config.component';
import { PhoneNumberMaskPipe } from 'src/app/common/pipes/phone-number.pipe';
import { ImpactDisciplesCommonModule } from 'src/app/common/impactdisciples.common.module';
import { AdminManagerComponent } from './admin-manager.component';
import { SharedModule } from '../shared/shared.module';
import { EmailTemplatesComponent } from './email-templates/email-templates.component';
import { CustomersComponent } from './customers/customers.component';
import { ShippingLabelsComponent } from './shipping-labels/shipping-labels.component';
import { ShippingLabelDialogComponent } from './shipping-labels/shipping-label-dialog.component';
import { AdminManagerRoutingModule } from './admin-manager-routing.module';
import { NotificationDialogComponent } from './notifications/notification-dialog.component';
import { AdminUserDialogComponent } from './admin-users/admin-user-dialog.component';
import { EmailTemplateDialogComponent } from './email-templates/email-template-dialog.component';
import { CustomerDialogComponent } from './customers/customer-dialog.component';
import { AddCustomerNoteDialogComponent } from './customers/add-customer-note-dialog.component';
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
import { MatToolbarModule } from '@angular/material/toolbar';
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
    MatToolbarModule,
    QuillModule
  ],
  declarations: [
    AdminManagerComponent,
    LogMessagesComponent,
    NotificationsComponent,
    NotificationDialogComponent,
    AdminUsersComponent,
    AdminUserDialogComponent,
    CustomersComponent,
    CustomerDialogComponent,
    AddCustomerNoteDialogComponent,
    WebConfigComponent,
    EmailTemplatesComponent,
    EmailTemplateDialogComponent,
    ShippingLabelsComponent,
    ShippingLabelDialogComponent
  ],
  providers:[
    PhoneNumberMaskPipe
  ]
})
export class AdminManagerModule { }
