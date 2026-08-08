import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LogMessagesComponent } from './log-messages/log-messages.component';
import { UsersComponent } from './users/users.component';
import { DxButtonModule, DxCheckBoxModule, DxContextMenuModule, DxDataGridModule, DxFileUploaderModule, DxFormModule, DxHtmlEditorModule, DxListModule, DxLoadIndicatorModule,
         DxLoadPanelModule,
         DxLookupModule,
         DxNumberBoxModule,
         DxPopupModule, DxSelectBoxModule, DxSwitchModule, DxTabsModule, DxTagBoxModule, DxTextAreaModule, DxTextBoxModule,
         DxToolbarModule,
         DxTreeListModule,
         DxValidatorModule} from 'devextreme-angular';
import { NotificationsComponent } from './notifications/notifications.component';
import { WebConfigComponent } from './web-config/web-config.component';
import { PhoneNumberMaskPipe } from 'impactdisciplescommon/src/pipes/phone-number.pipe';
import { ImpactDisciplesCommonModule } from 'impactdisciplescommon/src/impactdisciples.common.module';
import { AdminManagerComponent } from './admin-manager.component';
import { SharedModule } from '../shared/shared.module';
import { EmailTemplatesComponent } from './email-templates/email-templates.component';
import { CustomersComponent } from './customers/customers.component';
import { ShippingLabelsComponent } from './shipping-labels/shipping-labels.component';
import { ShippingLabelListComponent } from './shipping-labels/shippingLabelList/shippingLabelList.component';
import { ImageUploaderModule } from 'impactdisciplescommon/src/forms/image-uploader/image-uploader.module';
import { AdminManagerRoutingModule } from './admin-manager-routing.module';
import { NotificationDialogComponent } from './notifications/notification-dialog.component';
import { UserDialogComponent } from './users/user-dialog.component';
import { ReactiveFormsModule } from '@angular/forms';
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
import { QuillModule } from 'ngx-quill';


@NgModule({
  imports: [
    CommonModule,
    AdminManagerRoutingModule,
    ImageUploaderModule,
    DxCheckBoxModule,
    DxContextMenuModule,
    DxDataGridModule,
    DxButtonModule,
    DxFormModule,
    DxFileUploaderModule,
    DxHtmlEditorModule,
    DxLoadPanelModule,
    DxLookupModule,
    DxListModule,
    DxLoadIndicatorModule,
    DxNumberBoxModule,
    DxPopupModule,
    DxSelectBoxModule,
    DxSwitchModule,
    DxTabsModule,
    DxTagBoxModule,
    DxTextBoxModule,
    DxTextAreaModule,
    DxToolbarModule,
    DxTreeListModule,
    DxValidatorModule,
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
    MatTabsModule,
    MatProgressSpinnerModule,
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
    WebConfigComponent,
    EmailTemplatesComponent,
    ShippingLabelsComponent,
    ShippingLabelListComponent
  ],
  providers:[
    PhoneNumberMaskPipe
  ]
})
export class AdminManagerModule { }
