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
    SharedModule
  ],
  declarations: [
    AdminManagerComponent,
    LogMessagesComponent,
    NotificationsComponent,
    UsersComponent,
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
